"use client";
import JSZip from "jszip";
import TurndownService from "turndown";
import { db } from "./db";
import { enqueue } from "./sync";
import type { Note, Notebook } from "./types";

export type ImportedDoc = { title: string; markdown: string; tags?: string[] };

const td = () => {
  const t = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
  t.remove(["script", "style"]);
  return t;
};

export function htmlToMarkdown(html: string) {
  return td().turndown(html);
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/\s[0-9a-f]{32}$/i, ""); // Notion aggiunge un id al nome
}

/** Testo grezzo da un file per il riassunto intelligente. */
export async function extractText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "pptx") return pptxText(file);
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const r = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return htmlToMarkdown(r.value);
  }
  if (ext === "html" || ext === "htm") return htmlToMarkdown(await file.text());
  return file.text();
}

async function pptxText(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const parser = new DOMParser();
  const out: string[] = [];
  for (const [i, s] of slides.entries()) {
    const xml = parser.parseFromString(await zip.file(s)!.async("string"), "application/xml");
    const paras = [...xml.getElementsByTagName("a:p")]
      .map((p) => [...p.getElementsByTagName("a:t")].map((t) => t.textContent).join(""))
      .filter((t) => t.trim());
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${s.match(/\d+/)![0]}.xml`);
    let notes = "";
    if (notesFile) {
      const nx = parser.parseFromString(await notesFile.async("string"), "application/xml");
      notes = [...nx.getElementsByTagName("a:t")].map((t) => t.textContent).join(" ").trim();
    }
    out.push(`--- Slide ${i + 1} ---\n${paras.join("\n")}${notes ? `\n[Note del relatore: ${notes}]` : ""}`);
  }
  return out.join("\n\n");
}

/** Importazione diretta (senza AI) di formati testuali. */
export async function importDirect(file: File): Promise<ImportedDoc[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "md" || ext === "markdown" || ext === "txt") {
    return [parseMarkdownFile(baseName(file.name), await file.text())];
  }
  if (ext === "html" || ext === "htm") {
    const html = await file.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    return [{ title: doc.title || baseName(file.name), markdown: htmlToMarkdown(doc.body.innerHTML) }];
  }
  if (ext === "enex") return parseEnex(await file.text());
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const r = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return [{ title: baseName(file.name), markdown: htmlToMarkdown(r.value) }];
  }
  if (ext === "pptx") return [{ title: baseName(file.name), markdown: await pptxText(file) }];
  if (ext === "zip") return parseZip(file);
  throw new Error(`Formato non supportato: .${ext}`);
}

function parseMarkdownFile(name: string, text: string): ImportedDoc {
  let md = text;
  let tags: string[] = [];
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    const t = fm[1].match(/tags:\s*\[?([^\]\n]*)\]?/);
    if (t) tags = t[1].split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean);
    md = md.slice(fm[0].length);
  }
  const h1 = md.match(/^\s*#\s+(.+)\n/);
  const title = h1 ? h1[1].trim() : name;
  if (h1) md = md.slice(h1.index! + h1[0].length);
  return { title, markdown: md.trim(), tags };
}

/** Evernote (.enex) */
function parseEnex(xml: string): ImportedDoc[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return [...doc.getElementsByTagName("note")].map((n) => {
    const title = n.getElementsByTagName("title")[0]?.textContent ?? "Nota Evernote";
    const content = n.getElementsByTagName("content")[0]?.textContent ?? "";
    const enml = new DOMParser().parseFromString(content, "text/html");
    enml.querySelectorAll("en-media").forEach((m) => m.replaceWith("[allegato non importato]"));
    enml.querySelectorAll("en-todo").forEach((m) => m.replaceWith(m.getAttribute("checked") === "true" ? "☑ " : "☐ "));
    const tags = [...n.getElementsByTagName("tag")].map((t) => t.textContent ?? "").filter(Boolean);
    return { title, markdown: htmlToMarkdown(enml.body.innerHTML), tags };
  });
}

/** ZIP: export di Notion (md/html) oppure backup di questa app. */
async function parseZip(file: File): Promise<ImportedDoc[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  if (zip.file("backup.json")) {
    await restoreBackup(JSON.parse(await zip.file("backup.json")!.async("string")));
    return [];
  }
  const out: ImportedDoc[] = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const name = path.split("/").pop()!;
    if (/\.(md|markdown|txt)$/i.test(name)) out.push(parseMarkdownFile(baseName(name), await entry.async("string")));
    else if (/\.html?$/i.test(name)) {
      const html = await entry.async("string");
      const d = new DOMParser().parseFromString(html, "text/html");
      out.push({ title: d.title || baseName(name), markdown: htmlToMarkdown(d.body.innerHTML) });
    }
  }
  return out;
}

/** Ripristina un backup: aggiunge/aggiorna note e quaderni (non cancella nulla). */
async function restoreBackup(data: { notes: Note[]; notebooks: Notebook[] }) {
  for (const nb of data.notebooks ?? []) {
    await db.notebooks.put(nb);
    await enqueue("notebooks", nb.id);
  }
  for (const n of data.notes ?? []) {
    const existing = await db.notes.get(n.id);
    if (!existing || existing.updated_at < n.updated_at) {
      await db.notes.put(n);
      await enqueue("notes", n.id);
    }
  }
}

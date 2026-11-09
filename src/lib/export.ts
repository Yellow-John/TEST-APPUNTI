"use client";
import JSZip from "jszip";
import { db } from "./db";
import { noteTitle } from "./repo";
import type { Note } from "./types";

export function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80).trim() || "nota";
}

export function noteToMarkdown(n: Note) {
  const title = noteTitle(n);
  const front = n.tags.length ? `---\ntags: [${n.tags.join(", ")}]\n---\n\n` : "";
  return `${front}# ${title}\n\n${n.content}\n`;
}

export function exportMarkdown(n: Note) {
  download(new Blob([noteToMarkdown(n)], { type: "text/markdown" }), `${safeName(noteTitle(n))}.md`);
}

export function exportPdf(n: Note) {
  window.open(`/print?id=${n.id}`, "_blank");
}

// ---------- Word (.docx) ----------
export async function exportDocx(n: Note) {
  const d = await import("docx");
  const children: InstanceType<typeof d.Paragraph>[] = [];
  const inline = (text: string) => {
    const runs: InstanceType<typeof d.TextRun>[] = [];
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|==[^=]+==|\$[^$]+\$)/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (m.index! > last) runs.push(new d.TextRun(text.slice(last, m.index)));
      const t = m[0];
      if (t.startsWith("**")) runs.push(new d.TextRun({ text: t.slice(2, -2), bold: true }));
      else if (t.startsWith("==")) runs.push(new d.TextRun({ text: t.slice(2, -2), highlight: "yellow" }));
      else if (t.startsWith("`")) runs.push(new d.TextRun({ text: t.slice(1, -1), font: "Consolas" }));
      else if (t.startsWith("$")) runs.push(new d.TextRun({ text: t.slice(1, -1), italics: true, font: "Cambria Math" }));
      else runs.push(new d.TextRun({ text: t.slice(1, -1), italics: true }));
      last = m.index! + t.length;
    }
    if (last < text.length) runs.push(new d.TextRun(text.slice(last)));
    return runs;
  };
  children.push(new d.Paragraph({ text: noteTitle(n), heading: d.HeadingLevel.TITLE }));
  const lines = n.content.split("\n");
  for (const raw of lines) {
    const line = raw.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_m, a, _b, c) => c || a);
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (img) {
      try {
        const res = await fetch(img[2]);
        const buf = await res.arrayBuffer();
        const bmp = await createImageBitmap(new Blob([buf]));
        const w = Math.min(500, bmp.width);
        const type = (res.headers.get("content-type") || "").includes("png") ? "png" : "jpg";
        children.push(
          new d.Paragraph({
            children: [
              new d.ImageRun({ type, data: buf, transformation: { width: w, height: (bmp.height * w) / bmp.width } }),
            ],
          }),
        );
        continue;
      } catch {
        /* immagine non disponibile */
      }
    }
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      const levels = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];
      children.push(new d.Paragraph({ children: inline(h[2]), heading: levels[h[1].length - 1] }));
    } else if (/^\s*[-*+]\s+/.test(line)) {
      const level = Math.min(3, Math.floor((line.match(/^\s*/)![0].length) / 2));
      children.push(new d.Paragraph({ children: inline(line.replace(/^\s*[-*+]\s+(\[[ x]\]\s*)?/, "")), bullet: { level } }));
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      children.push(new d.Paragraph({ children: inline(line.trim()) }));
    } else if (/^>\s?/.test(line)) {
      children.push(new d.Paragraph({ children: inline(line.replace(/^>\s?/, "")), indent: { left: 400 } }));
    } else {
      children.push(new d.Paragraph({ children: inline(line) }));
    }
  }
  const doc = new d.Document({ sections: [{ children }] });
  download(await d.Packer.toBlob(doc), `${safeName(noteTitle(n))}.docx`);
}

// ---------- Backup completo ----------
export async function exportBackup(onProgress?: (msg: string) => void) {
  const zip = new JSZip();
  const notes = (await db.notes.toArray()).filter((n) => !isPurged(n));
  const notebooks = (await db.notebooks.toArray()).filter((n) => !n.deleted_at);
  zip.file("backup.json", JSON.stringify({ version: 1, exported_at: new Date().toISOString(), notebooks, notes }, null, 2));
  const nbName = new Map(notebooks.map((n) => [n.id, n.name]));
  const files = new Set<string>();
  for (const n of notes) {
    if (n.deleted_at || n.is_locked) continue;
    const folder = safeName(n.notebook_id ? nbName.get(n.notebook_id) ?? "Senza quaderno" : "Senza quaderno");
    let md = noteToMarkdown(n);
    for (const m of n.content.matchAll(/\/api\/file\/([^\s)"]+)/g)) {
      const p = decodeURIComponent(m[1]);
      files.add(p);
      md = md.replaceAll(m[0], `../files/${p.split("/").pop()}`);
    }
    zip.file(`note/${folder}/${safeName(noteTitle(n))}-${n.id.slice(0, 6)}.md`, md);
  }
  let i = 0;
  for (const p of files) {
    onProgress?.(`Immagini ${++i}/${files.size}`);
    try {
      const res = await fetch(`/api/file/${p.split("/").map(encodeURIComponent).join("/")}`);
      if (res.ok) zip.file(`files/${p.split("/").pop()}`, await res.blob());
    } catch {
      /* salta */
    }
  }
  onProgress?.("Compressione…");
  const blob = await zip.generateAsync({ type: "blob" });
  download(blob, `appunti-backup-${new Date().toISOString().slice(0, 10)}.zip`);
}

export function isPurged(n: Pick<Note, "deleted_at">) {
  return !!n.deleted_at && n.deleted_at < "2000";
}

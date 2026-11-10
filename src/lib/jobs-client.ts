"use client";
import { aiPost } from "./ai-client";
import { db, uuid } from "./db";
import { fileUrl, uploadFile } from "./files";
import { compressCanvas, cropCanvas, loadImage } from "./image";
import { updateNote } from "./repo";
import type { Note, NoteJob, SummaryLevel } from "./types";

/** Salva in locale la nota restituita dal server, così si apre subito (anche prima della sincronizzazione). */
async function keep(note: Note) {
  await db.notes.put(note);
  return note.id;
}

export async function startOcrJob(o: {
  paths: string[];
  hint?: string;
  notebookId?: string | null;
  noteId?: string;
  mode?: "transcribe" | "summary";
  level?: SummaryLevel;
}) {
  const mode = o.mode ?? "transcribe";
  const r = await aiPost<{ note: Note }>(
    "ocr",
    { noteId: o.noteId ?? uuid(), notebookId: o.notebookId || null, paths: o.paths, hint: o.hint || undefined, mode, level: o.level ?? "standard" },
    mode === "summary" ? `riassunto di ${o.paths.length} foto` : `trascrizione di ${o.paths.length} foto`,
  );
  return keep(r.note);
}

export async function startImportJob(o: {
  path?: string;
  text?: string;
  filename: string;
  kind: "pdf" | "slides" | "import";
  mode: "full" | "smart";
  level: SummaryLevel;
  notebookId?: string | null;
  noteId?: string;
}) {
  const r = await aiPost<{ note: Note }>(
    "import",
    { ...o, noteId: o.noteId ?? uuid(), notebookId: o.notebookId || null },
    o.mode === "smart" ? `riassunto intelligente di "${o.filename}"` : `conversione di "${o.filename}"`,
  );
  return keep(r.note);
}

/** Ripete un'elaborazione fallita sulla stessa nota. */
export async function retryJob(note: Note) {
  const job = note.source.job as NoteJob | undefined;
  if (!job) throw new Error("Questa elaborazione non si può ripetere: importa di nuovo il file.");
  if (job.kind === "ocr") return startOcrJob({ paths: job.paths, hint: job.hint, mode: job.mode, level: job.level, noteId: note.id, notebookId: note.notebook_id });
  return startImportJob({
    path: job.path,
    filename: job.filename,
    kind: "pdf",
    mode: job.mode,
    level: job.level,
    noteId: note.id,
    notebookId: note.notebook_id,
  });
}

const cropping = new Set<string>();

/** Ritaglia dalle foto originali le figure indicate dall'AI e le inserisce nella nota al posto dei segnaposto. */
export async function cropPendingFigures(note: Note) {
  const figures = note.source.figures;
  const files = note.source.files ?? [];
  if (!figures?.length || cropping.has(note.id)) return;
  cropping.add(note.id);
  try {
    const pages = new Map<number, HTMLCanvasElement>();
    let md = note.content;
    for (const fig of figures) {
      const marker = `[[FIGURA:${fig.id}]]`;
      try {
        if (!files[fig.page]) throw new Error("pagina mancante");
        if (!pages.has(fig.page)) {
          const img = await loadImage(await (await fetch(fileUrl(files[fig.page]))).blob());
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext("2d")!.drawImage(img, 0, 0);
          pages.set(fig.page, c);
        }
        const [ymin, xmin, ymax, xmax] = fig.box_2d.map((v) => Math.min(1000, Math.max(0, v)) / 1000);
        const crop = cropCanvas(pages.get(fig.page)!, { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin });
        const { blob, ext } = await compressCanvas(crop, 0.82);
        const path = await uploadFile(blob, `notes/${note.id}`, ext);
        md = md.replace(marker, `\n![${fig.caption}](${fileUrl(path)})\n`);
      } catch {
        md = md.replace(marker, `_[Figura: ${fig.caption}]_`);
      }
    }
    md = md.replace(/\[\[FIGURA:\d+\]\]/g, "");
    const { figures: _f, ...source } = note.source;
    void _f;
    await updateNote(note.id, { content: md.trim(), source });
  } finally {
    cropping.delete(note.id);
  }
}

"use client";
import { db } from "./db";
import { updateNote } from "./repo";
import { toast } from "./toast";

export const NOTE_DRAG_TYPE = "application/x-appunti-note";

/** Sposta una o più note in un quaderno (null = senza quaderno). */
export async function moveNotes(noteIds: string[], notebookId: string | null) {
  const nb = notebookId ? await db.notebooks.get(notebookId) : null;
  for (const id of noteIds) await updateNote(id, { notebook_id: notebookId });
  const where = nb ? `«${nb.name}»` : "Senza quaderno";
  toast(noteIds.length === 1 ? `Nota spostata in ${where}` : `${noteIds.length} note spostate in ${where}`);
}

/** Proprietà per rendere un elemento una destinazione di trascinamento delle note (solo PC). */
export function noteDropProps(notebookId: string | null, setOver: (v: boolean) => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(NOTE_DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(NOTE_DRAG_TYPE);
      setOver(false);
      if (!id) return;
      e.preventDefault();
      void moveNotes([id], notebookId);
    },
  };
}

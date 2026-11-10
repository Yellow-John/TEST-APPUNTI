"use client";
import { db, nowIso, uuid } from "./db";
import { enqueue } from "./sync";
import type { Note, Notebook } from "./types";

export function blankNote(partial: Partial<Note> = {}): Note {
  const now = nowIso();
  return {
    id: uuid(),
    notebook_id: null,
    title: "",
    content: "",
    tags: [],
    is_favorite: false,
    is_pinned: false,
    is_archived: false,
    is_locked: false,
    locked_payload: null,
    source: { type: "manual" },
    share_token: null,
    share_mode: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...partial,
  };
}

export async function createNote(partial: Partial<Note> = {}): Promise<Note> {
  const note = blankNote(partial);
  await db.notes.put(note);
  await enqueue("notes", note.id);
  return note;
}

export async function updateNote(id: string, patch: Partial<Note>) {
  await db.notes.update(id, { ...patch, updated_at: nowIso() });
  await enqueue("notes", id);
}

export async function trashNote(id: string) {
  await updateNote(id, { deleted_at: nowIso(), is_pinned: false });
}

export async function restoreNote(id: string) {
  await updateNote(id, { deleted_at: null });
}

/** Eliminazione definitiva: il server la vede come "svuotata e cestinata da molto". */
export async function purgeNote(id: string) {
  await updateNote(id, {
    title: "",
    content: "",
    locked_payload: null,
    tags: [],
    share_token: null,
    share_mode: null,
    deleted_at: "1970-01-01T00:00:00.000Z",
  });
}

export async function createNotebook(name: string, parent_id: string | null = null): Promise<Notebook> {
  const now = nowIso();
  const nb: Notebook = {
    id: uuid(),
    parent_id,
    name,
    color: null,
    position: Date.now(),
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await db.notebooks.put(nb);
  await enqueue("notebooks", nb.id);
  return nb;
}

export async function updateNotebook(id: string, patch: Partial<Notebook>) {
  await db.notebooks.update(id, { ...patch, updated_at: nowIso() });
  await enqueue("notebooks", id);
}

export async function deleteNotebook(id: string) {
  // le note del quaderno tornano in "Senza quaderno"
  const notes = await db.notes.where("notebook_id").equals(id).toArray();
  for (const n of notes) await updateNote(n.id, { notebook_id: null });
  const children = await db.notebooks.where("parent_id").equals(id).toArray();
  for (const c of children) await updateNotebook(c.id, { parent_id: null });
  await updateNotebook(id, { deleted_at: nowIso() });
}

/** Testo leggibile della nota (titolo o prima riga). */
export function noteTitle(n: Pick<Note, "title" | "content"> & { is_locked?: boolean }): string {
  if (n.title.trim()) return n.title.trim();
  if (n.is_locked) return "Nota bloccata";
  const first = n.content.split("\n").find((l) => l.trim());
  return first ? first.replace(/^#+\s*/, "").slice(0, 80) : "Nota senza titolo";
}

"use client";
import { decryptText, encryptText } from "./crypto";
import { db } from "./db";
import { updateNote, updateNotebook } from "./repo";
import type { Note, Notebook } from "./types";

// Note bloccate: titolo e contenuto cifrati insieme nel browser (AES-GCM, chiave dal PIN).
// Il PIN viene chiesto ogni volta che si apre una nota o un quaderno bloccato.

export type Plain = { title: string; content: string };

export async function encryptNote(key: CryptoKey, p: Plain): Promise<string> {
  return encryptText(key, JSON.stringify({ v: 2, t: p.title, c: p.content }));
}

/** Decifra; compatibile con le note bloccate dalla versione precedente (solo contenuto cifrato, titolo in chiaro). */
export async function decryptNote(key: CryptoKey, note: Pick<Note, "title" | "locked_payload">): Promise<Plain> {
  if (!note.locked_payload) return { title: note.title, content: "" };
  const raw = await decryptText(key, note.locked_payload);
  try {
    const j = JSON.parse(raw) as { v?: number; t?: string; c?: string };
    if (j && j.v === 2) return { title: j.t ?? "", content: j.c ?? "" };
  } catch {
    /* formato precedente */
  }
  return { title: note.title, content: raw };
}

export async function lockNote(note: Note, key: CryptoKey, p: Plain) {
  await updateNote(note.id, {
    is_locked: true,
    title: "",
    content: "",
    locked_payload: await encryptNote(key, p),
    share_mode: null,
    share_token: null,
  });
}

export async function unlockNotePermanently(note: Note, key: CryptoKey) {
  const p = await decryptNote(key, note);
  await updateNote(note.id, { is_locked: false, locked_payload: null, title: p.title, content: p.content });
  return p;
}

// ---------- passaggio della chiave tra schermate (una sola volta, solo in memoria) ----------
// Dopo aver sbloccato un quaderno, aprire una sua nota non richiede di nuovo il PIN.
const handoff = new Map<string, { key: CryptoKey; at: number }>();
export function handKey(noteId: string, key: CryptoKey) {
  handoff.set(noteId, { key, at: Date.now() });
}
export function takeKey(noteId: string): CryptoKey | null {
  const h = handoff.get(noteId);
  handoff.delete(noteId);
  return h && Date.now() - h.at < 60_000 ? h.key : null;
}

// ---------- quaderni ----------
/** Il quaderno e i suoi sotto-quaderni. */
export async function notebookTree(rootId: string): Promise<string[]> {
  const all = (await db.notebooks.toArray()).filter((n) => !n.deleted_at);
  const ids = [rootId];
  for (let i = 0; i < ids.length; i++) all.filter((n) => n.parent_id === ids[i]).forEach((n) => ids.push(n.id));
  return ids;
}

/** Quaderno bloccato direttamente o tramite un quaderno che lo contiene. */
export function lockedAncestor(nbId: string | null, notebooks: Notebook[]): Notebook | null {
  const byId = new Map(notebooks.map((n) => [n.id, n]));
  let cur = nbId ? byId.get(nbId) : undefined;
  for (let guard = 0; cur && guard < 50; guard++) {
    if (cur.is_locked && !cur.deleted_at) return cur;
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return null;
}

export async function lockNotebook(nb: Notebook, key: CryptoKey) {
  const ids = new Set(await notebookTree(nb.id));
  const notes = (await db.notes.toArray()).filter((n) => n.notebook_id && ids.has(n.notebook_id) && !n.deleted_at && !n.is_locked);
  for (const n of notes) await lockNote(n, key, { title: n.title, content: n.content });
  await updateNotebook(nb.id, { is_locked: true });
  return notes.length;
}

export async function unlockNotebook(nb: Notebook, key: CryptoKey) {
  const ids = new Set(await notebookTree(nb.id));
  const notes = (await db.notes.toArray()).filter((n) => n.notebook_id && ids.has(n.notebook_id) && n.is_locked);
  let failed = 0;
  for (const n of notes) {
    try {
      await unlockNotePermanently(n, key);
    } catch {
      failed++;
    }
  }
  await updateNotebook(nb.id, { is_locked: false });
  return { unlocked: notes.length - failed, failed };
}

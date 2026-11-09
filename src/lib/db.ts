"use client";
import Dexie, { type EntityTable } from "dexie";
import type { Note, Notebook } from "./types";

export type OutboxItem = {
  id?: number;
  table: "notes" | "notebooks";
  rowId: string;
  queued_at: string;
};

export type Meta = { key: string; value: string };

// Database locale (IndexedDB): l'app legge sempre da qui, così funziona offline.
export const db = new Dexie("appunti") as Dexie & {
  notes: EntityTable<Note, "id">;
  notebooks: EntityTable<Notebook, "id">;
  outbox: EntityTable<OutboxItem, "id">;
  meta: EntityTable<Meta, "key">;
};

db.version(1).stores({
  notes: "id, notebook_id, updated_at, deleted_at, *tags",
  notebooks: "id, parent_id, updated_at",
  outbox: "++id, [table+rowId]",
  meta: "key",
});

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

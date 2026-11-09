"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "./db";
import { noteTitle } from "./repo";

const EMPTY: never[] = [];

/** Mappa titolo (minuscolo) → id, per i collegamenti [[...]]. */
export function useWikiIndex() {
  const notes = useLiveQuery(() => db.notes.toArray(), []) ?? EMPTY;
  return useMemo(() => {
    const m = new Map<string, string>();
    notes
      .filter((n) => !n.deleted_at)
      .forEach((n) => {
        const t = noteTitle(n).toLowerCase();
        if (!m.has(t)) m.set(t, n.id);
      });
    return m;
  }, [notes]);
}

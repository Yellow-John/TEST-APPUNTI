"use client";
// Note aperte di recente (solo su questo dispositivo), per la ricerca rapida.
const KEY = "recent-notes";

export function rememberNote(id: string) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]") as string[];
    localStorage.setItem(KEY, JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, 15)));
  } catch {
    /* ignora */
  }
}

export function recentNotes(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

export const openPalette = () => window.dispatchEvent(new Event("open-palette"));

"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { MarkdownView } from "@/components/MarkdownView";
import { db } from "@/lib/db";
import { noteTitle } from "@/lib/repo";
import type { Note } from "@/lib/types";

// Vista di stampa: "Salva come PDF" dalla finestra di stampa del browser.
function PrintInner() {
  const id = useSearchParams().get("id");
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    if (id) db.notes.get(id).then((n) => setNote(n ?? null));
  }, [id]);
  useEffect(() => {
    if (!note) return;
    const imgs = [...document.images];
    Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))).then(() =>
      setTimeout(() => window.print(), 400),
    );
  }, [note]);
  if (!note) return <p className="p-8">Caricamento…</p>;
  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-black">
      <h1 className="mb-1 text-3xl font-bold">{noteTitle(note)}</h1>
      <p className="mb-6 text-sm text-gray-500">
        {new Date(note.updated_at).toLocaleDateString("it-IT")} {note.tags.length > 0 && `· ${note.tags.map((t) => `#${t}`).join(" ")}`}
      </p>
      <MarkdownView content={note.content} />
    </article>
  );
}

export default function PrintPage() {
  return (
    <Suspense>
      <PrintInner />
    </Suspense>
  );
}

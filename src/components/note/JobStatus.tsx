"use client";
import { AlertTriangle, Loader2, PenLine, RotateCcw, ScanText, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fileUrl } from "@/lib/files";
import { retryJob } from "@/lib/jobs-client";
import { offlineOcr } from "@/lib/ocr-offline";
import { trashNote, updateNote } from "@/lib/repo";
import type { Note } from "@/lib/types";

const STALE_MS = 6 * 60 * 1000; // oltre il limite di 5 minuti delle funzioni Vercel: elaborazione interrotta

/** Nota in elaborazione AI (in background sul server) o con elaborazione fallita. */
export function JobStatus({ note }: { note: Note }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const started = new Date(note.updated_at).getTime();
  const stale = note.source.status === "processing" && now - started > STALE_MS;
  const failed = note.source.status === "error" || stale;
  const job = note.source.job;
  const photos = note.source.files ?? [];
  const seconds = Math.max(0, Math.round((now - started) / 1000));

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setErr("");
    try {
      await fn();
    } catch (e) {
      if ((e as Error).message !== "Annullato") setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const clearStatus = () => {
    const { status: _s, error: _e, error_code: _c, job: _j, ...source } = note.source;
    void _s; void _e; void _c; void _j;
    return source;
  };

  const offline = () =>
    run("ocr", async () => {
      const blobs = await Promise.all(photos.map(async (p) => (await fetch(fileUrl(p))).blob()));
      const content = await offlineOcr(blobs, setBusy);
      await updateNote(note.id, { title: "", content, source: clearStatus() });
    });

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Link href="/notes" className="text-sm text-accent">← Tutte le note</Link>
      <div className="card mt-4 p-6 text-center">
        {!failed ? (
          <>
            <Loader2 size={36} className="mx-auto animate-spin text-accent" />
            <h1 className="mt-4 text-lg font-semibold">{note.title || "Elaborazione in corso…"}</h1>
            <p className="mt-2 text-sm text-muted">
              L&apos;AI sta lavorando sul server ({seconds} s). <b>Puoi uscire da questa schermata o chiudere l&apos;app</b>: la nota si completerà da sola
              e la ritroverai nell&apos;elenco.
            </p>
          </>
        ) : (
          <>
            <AlertTriangle size={36} className="mx-auto text-danger" />
            <h1 className="mt-4 text-lg font-semibold">Elaborazione non riuscita</h1>
            <p className="mt-2 text-sm text-muted">
              {stale ? "L'elaborazione si è interrotta (tempo massimo superato)." : note.source.error || "Errore sconosciuto."}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {job && (
                <button className="btn-primary !py-2.5" disabled={!!busy} onClick={() => run("retry", () => retryJob(note))}>
                  <RotateCcw size={16} /> {busy === "retry" ? "Avvio…" : "Riprova con l'AI"}
                </button>
              )}
              {photos.length > 0 && (
                <button className="btn !py-2.5" disabled={!!busy} onClick={offline}>
                  <ScanText size={16} /> {busy && busy !== "retry" ? busy : "Trascrivi senza AI (solo testo stampato)"}
                </button>
              )}
              <button className="btn !py-2.5" disabled={!!busy} onClick={() => updateNote(note.id, { title: "", source: clearStatus() })}>
                <PenLine size={16} /> Scrivi la nota a mano
              </button>
              <button
                className="btn !py-2.5 text-danger"
                disabled={!!busy}
                onClick={async () => {
                  await trashNote(note.id);
                  router.push("/notes");
                }}
              >
                <Trash2 size={16} /> Elimina
              </button>
            </div>
          </>
        )}
        {err && <p className="mt-3 text-sm text-danger">{err}</p>}
      </div>
      {photos.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p} src={fileUrl(p)} alt="Foto" className="aspect-[3/4] w-full rounded-lg object-cover" loading="lazy" />
          ))}
        </div>
      )}
    </div>
  );
}

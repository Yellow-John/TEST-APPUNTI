"use client";
import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { retryJob } from "@/lib/jobs-client";
import { updateNote } from "@/lib/repo";
import type { Note } from "@/lib/types";

/** Avviso per le note trascritte da un modello di riserva (quota del Flash esaurita): più errori di lettura. */
export function ModelFallbackBanner({ note }: { note: Note }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!note.source?.model_fallback) return null;
  const canRetry = note.source.job?.kind === "ocr";

  async function retry() {
    if (!confirm("La nota verrà ritrascritta dalle foto e le modifiche fatte a mano andranno perse. Continuare?")) return;
    setBusy(true);
    setErr("");
    try {
      await retryJob(note);
    } catch (e) {
      if ((e as Error).message !== "Annullato") setErr((e as Error).message);
      setBusy(false);
    }
  }

  const dismiss = () => {
    const { model_fallback: _f, ...source } = note.source;
    void _f;
    return updateNote(note.id, { source });
  };

  return (
    <div className="no-print mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle size={15} className="shrink-0" />
      <span className="min-w-0 flex-1">
        Trascritta con un modello di riserva (<code className="text-xs">{note.source.model || "sconosciuto"}</code>) perché la quota di quello principale era finita:
        controlla le parole, potrebbe contenere più errori.
      </span>
      {canRetry && (
        <button className="btn !py-1 text-xs" disabled={busy} onClick={retry}>
          <RotateCcw size={13} /> {busy ? "Avvio…" : "Ritrascrivi"}
        </button>
      )}
      <button className="btn-icon" aria-label="Nascondi avviso" title="Ho controllato, nascondi" onClick={dismiss}>
        <X size={14} />
      </button>
      {err && <p className="w-full text-xs text-danger">{err}</p>}
    </div>
  );
}

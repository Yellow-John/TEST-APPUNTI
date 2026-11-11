"use client";
import { Eye, EyeOff, Image as ImageIcon, RectangleHorizontal, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { fileUrl, removeFile } from "@/lib/files";
import { updateNote } from "@/lib/repo";
import { isSensitiveNote } from "@/lib/secrets";
import type { Note } from "@/lib/types";
import { ImageAnnotator } from "./ImageAnnotator";

/**
 * Foto da cui è stata trascritta la nota. Se la nota contiene dati sensibili (anche già mascherati nel testo)
 * le foto restano sfocate finché l'utente non le mostra, e si possono coprire o eliminare.
 */
export function OriginalPhotos({ note, content, readOnly }: { note: Note; content: string; readOnly: boolean }) {
  const files = note.source.files ?? [];
  const sensitive = note.is_locked || isSensitiveNote(content, note.tags);
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [covering, setCovering] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hidden = sensitive && !revealed;

  async function replace(oldPath: string, newPath: string | null) {
    setBusy(true);
    try {
      const next = files.flatMap((f) => (f === oldPath ? (newPath ? [newPath] : []) : [f]));
      await updateNote(note.id, { source: { ...note.source, files: next } });
      // l'originale con il dato in chiaro non deve restare nello storage
      await removeFile(oldPath);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(path: string) {
    if (!confirm("Eliminare definitivamente questa foto originale? Il testo della nota resta com'è.")) return;
    await replace(path, null);
  }

  return (
    <div className="no-print mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <button className="flex items-center gap-1.5 text-sm text-muted hover:text-fg" onClick={() => setOpen(!open)}>
          <ImageIcon size={15} /> Foto originali ({files.length}) {open ? "▴" : "▾"}
        </button>
        {open && sensitive && (
          <button className="chip hover:!text-fg" onClick={() => setRevealed(!revealed)}>
            {revealed ? <EyeOff size={11} /> : <Eye size={11} />} {revealed ? "Nascondi" : "Mostra"}
          </button>
        )}
      </div>

      {open && sensitive && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
          <ShieldAlert size={14} className="mt-px shrink-0 text-danger" />
          <span>
            Questa nota contiene dati sensibili e le foto li mostrano in chiaro, anche se nel testo sono mascherati.
            {!readOnly && " Coprili sulla foto o elimina la foto."}
          </span>
        </p>
      )}

      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {files.map((f) => (
            <div key={f} className="relative overflow-hidden rounded-lg">
              {hidden ? (
                <button className="block w-full" onClick={() => setRevealed(true)} aria-label="Mostra la foto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(f)} alt="" className="aspect-[3/4] w-full scale-110 object-cover blur-2xl" loading="lazy" draggable={false} />
                  <span className="absolute inset-0 flex items-center justify-center gap-1 text-xs font-medium text-fg">
                    <EyeOff size={14} /> Nascosta
                  </span>
                </button>
              ) : (
                <a href={fileUrl(f)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(f)} alt="Foto originale" className="aspect-[3/4] w-full object-cover" loading="lazy" />
                </a>
              )}
              {sensitive && !readOnly && (
                <div className="absolute bottom-1 right-1 flex gap-1">
                  <button className="btn-icon !bg-panel/90" disabled={busy} onClick={() => setCovering(f)} title="Copri i dati sensibili" aria-label="Copri i dati sensibili">
                    <RectangleHorizontal size={15} fill="currentColor" />
                  </button>
                  <button className="btn-icon !bg-panel/90 text-danger" disabled={busy} onClick={() => remove(f)} title="Elimina foto" aria-label="Elimina foto">
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {covering && (
        <ImageAnnotator
          src={fileUrl(covering)}
          noteId={note.id}
          initialTool="cover"
          title="Copri i dati sensibili"
          onClose={() => setCovering(null)}
          onSave={(_, path) => {
            const old = covering;
            setCovering(null);
            void replace(old, path);
          }}
        />
      )}
    </div>
  );
}

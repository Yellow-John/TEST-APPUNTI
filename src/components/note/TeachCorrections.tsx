"use client";
import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { addCorrections, diffCorrections } from "@/lib/handwriting-client";
import { updateNote } from "@/lib/repo";
import type { Note } from "@/lib/types";
import { Modal } from "../Modal";

/** Dopo che l'utente ha corretto una nota trascritta: propone le coppie «letto male → corretto» da ricordare. */
export function TeachCorrections({ note, content }: { note: Note; content: string }) {
  const original = note.source?.ocr_original;
  const pairs = useMemo(() => (original ? diffCorrections(original, content) : []), [original, content]);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  if (!original || (!pairs.length && !done)) return null;

  async function forget() {
    // il testo attuale diventa il nuovo riferimento: le stesse coppie non vengono riproposte
    await updateNote(note.id, { source: { ...note.source, ocr_original: content } });
  }

  async function save() {
    setBusy(true);
    try {
      await addCorrections(pairs.filter((_, i) => checked.has(i)));
      await forget();
      setDone(`${checked.size} correzioni salvate: verranno usate nelle prossime trascrizioni.`);
      setOpen(false);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="no-print mt-3 rounded-lg bg-green-50 p-2 text-sm text-green-800 dark:bg-green-950/40 dark:text-green-200">✓ {done}</p>;

  return (
    <>
      <div className="no-print mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-accent-soft p-2 text-sm">
        <GraduationCap size={16} className="text-accent" />
        <span className="flex-1">Hai corretto {pairs.length === 1 ? "1 parola" : `${pairs.length} parole`} della trascrizione.</span>
        <button
          className="btn-primary !py-1 text-xs"
          onClick={() => {
            setChecked(new Set(pairs.map((_, i) => i)));
            setOpen(true);
          }}
        >
          Insegna all&apos;AI le correzioni
        </button>
        <button className="btn-ghost !py-1 text-xs" onClick={forget}>Ignora</button>
      </div>
      {open && (
        <Modal title="Cosa deve imparare l'AI?" onClose={() => setOpen(false)}>
          <p className="mb-3 text-sm text-muted">
            Lascia spuntati solo gli <b>errori di lettura</b> della tua grafia; togli le modifiche fatte per altri motivi (riformulazioni, aggiunte).
          </p>
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
            {pairs.map((p, i) => (
              <li key={i}>
                <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-panel-2">
                  <input
                    type="checkbox"
                    checked={checked.has(i)}
                    onChange={(e) => {
                      const s = new Set(checked);
                      if (e.target.checked) s.add(i);
                      else s.delete(i);
                      setChecked(s);
                    }}
                  />
                  <span className="text-danger line-through">{p.wrong}</span>
                  <span className="text-muted">→</span>
                  <span className="text-ok">{p.right}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-2">
            <Link href="/grafia" className="text-xs text-accent">La mia grafia</Link>
            <button className="btn ml-auto" onClick={() => setOpen(false)}>Annulla</button>
            <button className="btn-primary" onClick={save} disabled={busy || !checked.size}>
              Salva {checked.size}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

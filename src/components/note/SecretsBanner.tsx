"use client";
import { EyeOff, Lock, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { type SecretFinding, detectSecrets, maskValue, redactSecrets } from "@/lib/secrets";
import { Modal } from "../Modal";

const fingerprint = (fs: SecretFinding[]) => fs.map((f) => `${f.kind}:${f.value.length}:${f.value.slice(-3)}`).sort().join("|");

/** Avviso quando la nota contiene password, token o chiavi. */
export function SecretsBanner({ noteId, content, onLock, onChange }: { noteId: string; content: string; onLock: () => void; onChange: (next: string) => void }) {
  const findings = useMemo(() => detectSecrets(content), [content]);
  const [open, setOpen] = useState(false);
  const [ignored, setIgnored] = useState(() => {
    try {
      return localStorage.getItem(`secrets-ignored:${noteId}`) ?? "";
    } catch {
      return "";
    }
  });
  if (!findings.length || ignored === fingerprint(findings)) return null;

  const labels = [...new Set(findings.map((f) => f.label.toLowerCase()))].join(", ");
  const line = (f: SecretFinding) => {
    const s = content.lastIndexOf("\n", f.start - 1) + 1;
    const e = content.indexOf("\n", f.end);
    const raw = content.slice(s, e < 0 ? content.length : e);
    return raw.replace(f.value, maskValue(f.value)).slice(0, 90);
  };

  return (
    <>
      <div className="no-print mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">
        <ShieldAlert size={16} />
        <span className="flex-1">
          {findings.length === 1 ? "Questa nota contiene un dato sensibile" : `Questa nota contiene ${findings.length} dati sensibili`} ({labels}). Non verranno mai inviati all&apos;AI.
        </span>
        <button className="btn-primary !py-1 text-xs" onClick={onLock}>
          <Lock size={13} /> Blocca con PIN
        </button>
        <button className="btn !py-1 text-xs" onClick={() => setOpen(true)}>
          <EyeOff size={13} /> Vedi e maschera
        </button>
        <button
          className="btn-ghost !py-1 text-xs"
          onClick={() => {
            const fp = fingerprint(findings);
            try {
              localStorage.setItem(`secrets-ignored:${noteId}`, fp);
            } catch {
              /* ignora */
            }
            setIgnored(fp);
          }}
        >
          Ignora
        </button>
      </div>
      {open && (
        <Modal title="Dati sensibili trovati" onClose={() => setOpen(false)}>
          <p className="mb-3 text-sm text-muted">
            <b>Maschera</b> sostituisce il valore con •••••••• in modo definitivo. Se ti serve conservarlo, usa invece <b>Blocca con PIN</b>: la nota viene cifrata.
          </p>
          <ul className="space-y-2">
            {findings.map((f, i) => (
              <li key={`${f.start}-${i}`} className="flex items-center gap-2 rounded-lg bg-panel-2 p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-danger">{f.label}</p>
                  <p className="truncate font-mono text-xs">{line(f)}</p>
                </div>
                <button className="btn !py-1 text-xs" onClick={() => onChange(redactSecrets(content, [f]))}>
                  Maschera
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn" onClick={() => { setOpen(false); onLock(); }}>
              <Lock size={14} /> Blocca con PIN
            </button>
            <button className="btn-primary" onClick={() => { onChange(redactSecrets(content, findings)); setOpen(false); }}>
              Maschera tutti
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

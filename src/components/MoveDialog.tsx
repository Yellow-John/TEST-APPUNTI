"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, FolderOpen, FolderPlus, Lock } from "lucide-react";
import { db } from "@/lib/db";
import { moveNotes } from "@/lib/move";
import { createNotebook } from "@/lib/repo";
import type { Notebook } from "@/lib/types";
import { Modal } from "./Modal";

/** Scelta del quaderno di destinazione per una o più note. */
export function MoveDialog({ noteIds, current, onClose }: { noteIds: string[]; current: string | null; onClose: () => void }) {
  const notebooks = (useLiveQuery(() => db.notebooks.toArray(), []) ?? []).filter((n) => !n.deleted_at);

  const rows: { nb: Notebook; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) =>
    notebooks
      .filter((n) => n.parent_id === parent)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((nb) => {
        rows.push({ nb, depth });
        walk(nb.id, depth + 1);
      });
  walk(null, 0);

  async function pick(id: string | null) {
    if (id !== current) await moveNotes(noteIds, id);
    onClose();
  }

  const row = (key: string, label: React.ReactNode, active: boolean, onClick: () => void, depth = 0) => (
    <button
      key={key}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg py-2.5 pr-3 text-left text-sm hover:bg-panel-2 ${active ? "bg-accent-soft font-medium text-accent" : ""}`}
      style={{ paddingLeft: 12 + depth * 18 }}
    >
      {label}
      {active && <Check size={15} className="ml-auto shrink-0" />}
    </button>
  );

  return (
    <Modal title={noteIds.length === 1 ? "Sposta la nota in…" : `Sposta ${noteIds.length} note in…`} onClose={onClose}>
      <div className="max-h-[60vh] space-y-0.5 overflow-y-auto">
        {row("none", <><FolderOpen size={16} className="shrink-0 text-muted" /> Senza quaderno</>, current === null, () => pick(null))}
        {rows.map(({ nb, depth }) =>
          row(
            nb.id,
            <>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: nb.color ?? "var(--accent)" }} />
              <span className="truncate">{nb.name}</span>
              {nb.is_locked && <Lock size={12} className="shrink-0 text-muted" aria-label="Protetto da PIN" />}
            </>,
            current === nb.id,
            () => pick(nb.id),
            depth,
          ),
        )}
        {row(
          "new",
          <span className="flex items-center gap-2 text-accent"><FolderPlus size={16} /> Nuovo quaderno…</span>,
          false,
          async () => {
            const name = prompt("Nome del nuovo quaderno");
            if (name?.trim()) {
              const nb = await createNotebook(name.trim());
              await pick(nb.id);
            }
          },
        )}
      </div>
    </Modal>
  );
}

"use client";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive, BookOpen, ChevronRight, FolderPlus, Hash, Inbox, MessageCircle, Network, Pencil,
  Plus, Settings, Star, Trash2, Upload, Camera, FolderOpen,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { db } from "@/lib/db";
import { isPurged } from "@/lib/export";
import { createNotebook, deleteNotebook, updateNotebook } from "@/lib/repo";
import type { Notebook } from "@/lib/types";
import { SyncBadge } from "./SyncBadge";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const notebooks = useLiveQuery(() => db.notebooks.toArray(), []) ?? [];
  const notes = useLiveQuery(() => db.notes.toArray(), []) ?? [];

  const active = notebooks.filter((n) => !n.deleted_at).sort((a, b) => a.position - b.position);
  const live = notes.filter((n) => !n.deleted_at && !n.is_archived);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    live.forEach((n) => n.notebook_id && m.set(n.notebook_id, (m.get(n.notebook_id) ?? 0) + 1));
    return m;
  }, [live]);
  const tags = useMemo(() => {
    const m = new Map<string, number>();
    live.forEach((n) => n.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [live]);

  const isActive = (q: Record<string, string>) =>
    pathname === "/notes" && Object.entries(q).every(([k, v]) => (sp.get(k) ?? "") === v) &&
    ["view", "nb", "tag"].filter((k) => !(k in q)).every((k) => !sp.get(k));

  const item = (href: string, icon: React.ReactNode, label: string, activeNow: boolean, count?: number) => (
    <Link
      href={href}
      onClick={onNavigate}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${
        activeNow ? "bg-accent-soft text-accent font-medium" : "text-fg hover:bg-panel-2"
      }`}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count ? <span className="text-xs text-muted">{count}</span> : null}
    </Link>
  );

  return (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3" aria-label="Navigazione">
      <div className="mb-2 flex items-center justify-between px-1">
        <Link href="/notes" onClick={onNavigate} className="flex items-center gap-2 text-lg font-bold">
          <BookOpen size={20} className="text-accent" /> Appunti
        </Link>
        <SyncBadge />
      </div>

      <div className="mb-2 grid grid-cols-3 gap-1.5">
        <Link href="/note?new=1" onClick={onNavigate} className="btn-primary flex-col !gap-0.5 !py-2 text-xs">
          <Plus size={16} /> Nuova
        </Link>
        <Link href="/capture" onClick={onNavigate} className="btn flex-col !gap-0.5 !py-2 text-xs">
          <Camera size={16} /> Foto
        </Link>
        <Link href="/import" onClick={onNavigate} className="btn flex-col !gap-0.5 !py-2 text-xs">
          <Upload size={16} /> Importa
        </Link>
      </div>

      {item("/notes", <Inbox size={16} />, "Tutte le note", isActive({}), live.length)}
      {item("/notes?view=fav", <Star size={16} />, "Preferiti", isActive({ view: "fav" }))}
      {item("/chat", <MessageCircle size={16} />, "Chiedi ai tuoi appunti", pathname === "/chat")}
      {item("/graph", <Network size={16} />, "Mappa dei collegamenti", pathname === "/graph")}

      <SectionTitle
        title="Quaderni"
        action={
          <button
            className="btn-icon !h-7 !w-7"
            aria-label="Nuovo quaderno"
            onClick={async () => {
              const name = prompt("Nome del nuovo quaderno");
              if (name?.trim()) await createNotebook(name.trim());
            }}
          >
            <FolderPlus size={15} />
          </button>
        }
      />
      {item("/notes?nb=none", <FolderOpen size={16} />, "Senza quaderno", isActive({ nb: "none" }))}
      <NotebookTree all={active} parent={null} depth={0} counts={counts} currentNb={pathname === "/notes" ? sp.get("nb") : null} onNavigate={onNavigate} />

      {tags.length > 0 && (
        <>
          <SectionTitle title="Tag" />
          <div className="flex flex-wrap gap-1 px-1">
            {tags.slice(0, 40).map(([t, c]) => (
              <Link
                key={t}
                href={`/notes?tag=${encodeURIComponent(t)}`}
                onClick={onNavigate}
                className={`chip hover:text-fg ${sp.get("tag") === t ? "!bg-accent-soft !text-accent" : ""}`}
              >
                <Hash size={11} />
                {t} <span className="opacity-60">{c}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="mt-auto border-t border-line pt-2">
        {item("/notes?view=archive", <Archive size={16} />, "Archivio", isActive({ view: "archive" }))}
        {item(
          "/notes?view=trash",
          <Trash2 size={16} />,
          "Cestino",
          isActive({ view: "trash" }),
          notes.filter((n) => n.deleted_at && !isPurged(n)).length,
        )}
        {item("/settings", <Settings size={16} />, "Impostazioni", pathname === "/settings")}
      </div>
    </nav>
  );
}

function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mt-3 mb-0.5 flex items-center justify-between px-2.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</span>
      {action}
    </div>
  );
}

function NotebookTree({
  all, parent, depth, counts, currentNb, onNavigate,
}: {
  all: Notebook[]; parent: string | null; depth: number; counts: Map<string, number>; currentNb: string | null; onNavigate?: () => void;
}) {
  const children = all.filter((n) => n.parent_id === parent);
  return (
    <>
      {children.map((nb) => (
        <NotebookRow key={nb.id} nb={nb} all={all} depth={depth} counts={counts} currentNb={currentNb} onNavigate={onNavigate} />
      ))}
    </>
  );
}

function NotebookRow({
  nb, all, depth, counts, currentNb, onNavigate,
}: {
  nb: Notebook; all: Notebook[]; depth: number; counts: Map<string, number>; currentNb: string | null; onNavigate?: () => void;
}) {
  const hasChildren = all.some((n) => n.parent_id === nb.id);
  const [open, setOpen] = useState(true);
  const active = currentNb === nb.id;
  return (
    <>
      <div
        className={`group flex items-center gap-1 rounded-lg pr-1 text-sm ${active ? "bg-accent-soft text-accent font-medium" : "hover:bg-panel-2"}`}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          className={`p-1 text-muted ${hasChildren ? "" : "invisible"}`}
          onClick={() => setOpen(!open)}
          aria-label={open ? "Comprimi" : "Espandi"}
        >
          <ChevronRight size={14} className={`transition ${open ? "rotate-90" : ""}`} />
        </button>
        <Link href={`/notes?nb=${nb.id}`} onClick={onNavigate} className="flex flex-1 items-center gap-2 truncate py-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: nb.color ?? "var(--accent)" }} />
          <span className="truncate">{nb.name}</span>
        </Link>
        <span className="text-xs text-muted group-hover:hidden">{counts.get(nb.id) || ""}</span>
        <div className="hidden items-center group-hover:flex">
          <button
            className="p-1 text-muted hover:text-fg"
            aria-label="Nuovo sotto-quaderno"
            onClick={async () => {
              const name = prompt(`Nuovo sotto-quaderno in "${nb.name}"`);
              if (name?.trim()) await createNotebook(name.trim(), nb.id);
            }}
          >
            <Plus size={13} />
          </button>
          <button
            className="p-1 text-muted hover:text-fg"
            aria-label="Rinomina"
            onClick={async () => {
              const name = prompt("Nuovo nome", nb.name);
              if (name?.trim()) await updateNotebook(nb.id, { name: name.trim() });
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            className="p-1 text-muted hover:text-danger"
            aria-label="Elimina quaderno"
            onClick={async () => {
              if (confirm(`Eliminare il quaderno "${nb.name}"? Le note non verranno cancellate.`)) await deleteNotebook(nb.id);
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {open && <NotebookTree all={all} parent={nb.id} depth={depth + 1} counts={counts} currentNb={currentNb} onNavigate={onNavigate} />}
    </>
  );
}

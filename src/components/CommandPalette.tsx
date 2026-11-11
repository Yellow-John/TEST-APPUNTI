"use client";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Camera, FileText, FolderOpen, Hash, Lock, MessageCircle, Network, PenTool, Plus, Search, Settings, Trash2, Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/db";
import { isPurged } from "@/lib/export";
import { stripMarkdown } from "@/lib/markdown";
import { recentNotes } from "@/lib/recent";
import { noteTitle } from "@/lib/repo";

type Item = { id: string; group: string; label: string; hint?: string; icon: React.ReactNode; href: string };

const ACTIONS: Omit<Item, "group">[] = [
  { id: "a-new", label: "Nuova nota", icon: <Plus size={16} />, href: "/note?new=1" },
  { id: "a-photo", label: "Fotografa appunti", icon: <Camera size={16} />, href: "/capture" },
  { id: "a-import", label: "Importa PDF, slide o documenti", icon: <Upload size={16} />, href: "/import" },
  { id: "a-chat", label: "Chiedi ai tuoi appunti", icon: <MessageCircle size={16} />, href: "/chat" },
  { id: "a-graph", label: "Mappa dei collegamenti", icon: <Network size={16} />, href: "/graph" },
  { id: "a-hw", label: "La mia grafia", icon: <PenTool size={16} />, href: "/grafia" },
  { id: "a-trash", label: "Cestino", icon: <Trash2 size={16} />, href: "/notes?view=trash" },
  { id: "a-settings", label: "Impostazioni", icon: <Settings size={16} />, href: "/settings" },
];

const EMPTY_NOTES: never[] = [];
const EMPTY_NBS: never[] = [];
const norm = (s: string) => s.toLocaleLowerCase("it").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Ricerca rapida (Ctrl+K / ⌘K): note, quaderni, tag e azioni. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const notes = useLiveQuery(() => (open ? db.notes.toArray() : []), [open]) ?? EMPTY_NOTES;
  const notebooks = useLiveQuery(() => (open ? db.notebooks.toArray() : []), [open]) ?? EMPTY_NBS;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const live = notes.filter((n) => !n.deleted_at && !isPurged(n) && !n.source?.status);
    const nbName = new Map(notebooks.map((n) => [n.id, n.name]));
    const noteItem = (n: (typeof live)[number], group: string, hint?: string): Item => ({
      id: n.id,
      group,
      label: noteTitle(n),
      hint: hint ?? (n.notebook_id ? nbName.get(n.notebook_id) : undefined),
      icon: n.is_locked ? <Lock size={16} /> : <FileText size={16} />,
      href: `/note?id=${n.id}`,
    });
    const query = norm(q.trim());
    if (!query) {
      const byId = new Map(live.map((n) => [n.id, n]));
      const recent = recentNotes().map((id) => byId.get(id)).filter(Boolean).slice(0, 6) as typeof live;
      const fallback = recent.length ? recent : [...live].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);
      return [
        ...fallback.map((n) => noteItem(n, recent.length ? "Aperte di recente" : "Modificate di recente")),
        ...ACTIONS.map((a) => ({ ...a, group: "Azioni" })),
      ];
    }
    const words = query.split(/\s+/);
    // punteggio: titolo che inizia con la ricerca > parole nel titolo > tag > contenuto (le note bloccate solo per titolo)
    const scored = live
      .map((n) => {
        const title = norm(noteTitle(n));
        const tags = norm(n.tags.join(" "));
        const body = n.is_locked ? "" : norm(stripMarkdown(n.content));
        let score = 0;
        if (title.startsWith(query)) score += 100;
        if (words.every((w) => title.includes(w))) score += 50;
        if (words.every((w) => tags.includes(w))) score += 20;
        if (!score && words.every((w) => `${title} ${tags} ${body}`.includes(w))) score += 5;
        let hint: string | undefined;
        if (score === 5) {
          const i = body.indexOf(words[0]);
          hint = "…" + stripMarkdown(n.content).slice(Math.max(0, i - 20), i + 50).trim() + "…";
        }
        return { n, score, hint };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.n.updated_at.localeCompare(a.n.updated_at))
      .slice(0, 8)
      .map((x) => noteItem(x.n, "Note", x.hint));
    const nbs = notebooks
      .filter((nb) => !nb.deleted_at && words.every((w) => norm(nb.name).includes(w)))
      .slice(0, 4)
      .map((nb) => ({ id: nb.id, group: "Quaderni", label: nb.name, icon: <FolderOpen size={16} />, href: `/notes?nb=${nb.id}` }));
    const allTags = [...new Set(live.flatMap((n) => n.tags))];
    const tags = allTags
      .filter((t) => words.every((w) => norm(t).includes(w)))
      .slice(0, 4)
      .map((t) => ({ id: `t-${t}`, group: "Tag", label: `#${t}`, icon: <Hash size={16} />, href: `/notes?tag=${encodeURIComponent(t)}` }));
    const acts = ACTIONS.filter((a) => words.every((w) => norm(a.label).includes(w))).map((a) => ({ ...a, group: "Azioni" }));
    const search = { id: "a-search", group: "Cerca", label: `Cerca «${q.trim()}» in tutte le note`, icon: <Search size={16} />, href: `/notes?q=${encodeURIComponent(q.trim())}` };
    return [...scored, ...nbs, ...tags, ...acts, search];
  }, [q, notes, notebooks]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const go = (it: Item | undefined) => {
    if (!it) return;
    setOpen(false);
    router.push(it.href);
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 px-3 pt-[10vh]" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Ricerca rapida">
      <div className="card w-full max-w-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={18} className="text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === "Enter") { e.preventDefault(); go(items[active]); }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Cerca note, quaderni, tag o azioni…"
            className="w-full bg-transparent py-3.5 text-base outline-none placeholder:text-muted"
            aria-label="Cerca"
          />
          <kbd className="hidden rounded border border-line px-1.5 text-[11px] text-muted sm:block">Esc</kbd>
        </div>
        <ul ref={listRef} className="max-h-[55vh] overflow-y-auto p-1.5" role="listbox">
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={`${it.group}-${it.id}`}>
                {header && <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{header}</p>}
                <button
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(it)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${i === active ? "bg-accent-soft text-accent" : ""}`}
                >
                  <span className="shrink-0 text-muted">{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{it.label}</span>
                    {it.hint && <span className="block truncate text-xs text-muted">{it.hint}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="hidden border-t border-line px-3 py-2 text-[11px] text-muted sm:block">↑ ↓ per muoverti · Invio per aprire · Ctrl+K per aprire e chiudere</p>
      </div>
    </div>
  );
}

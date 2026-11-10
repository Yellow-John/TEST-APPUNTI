"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { Archive, FolderInput, Hash, Lock, LockOpen, Pin, Search, Sparkles, Star, Trash2, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MoveDialog } from "@/components/MoveDialog";
import { PinDialog } from "@/components/PinDialog";
import { NOTE_DRAG_TYPE } from "@/lib/move";
import { decryptNote, handKey, lockedAncestor } from "@/lib/lock";
import { aiPost } from "@/lib/ai-client";
import { db } from "@/lib/db";
import { isPurged } from "@/lib/export";
import { stripMarkdown } from "@/lib/markdown";
import { noteTitle, purgeNote, restoreNote, updateNote } from "@/lib/repo";
import type { Note } from "@/lib/types";

type Hit = { id: string; title: string; snippet: string; rank: number };

export default function NotesPage() {
  const sp = useSearchParams();
  const view = sp.get("view") ?? "all";
  const nb = sp.get("nb");
  const tag = sp.get("tag");
  const [q, setQ] = useState("");
  const [semantic, setSemantic] = useState<{ terms: string[]; hits: Hit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState("");
  // quaderno bloccato aperto con il PIN: chiave e titoli decifrati restano solo in memoria
  const [nbUnlock, setNbUnlock] = useState<{ nb: string; key: CryptoKey; titles: Map<string, string> } | null>(null);
  const [askPin, setAskPin] = useState(false);

  const notes = useLiveQuery(() => db.notes.toArray(), []);
  const notebooks = useLiveQuery(() => db.notebooks.toArray(), []);
  const nbMap = useMemo(() => new Map((notebooks ?? []).map((n) => [n.id, n])), [notebooks]);

  // sotto-quaderni inclusi
  const nbIds = useMemo(() => {
    if (!nb || nb === "none") return null;
    const ids = new Set([nb]);
    let added = true;
    while (added) {
      added = false;
      (notebooks ?? []).forEach((n) => {
        if (n.parent_id && ids.has(n.parent_id) && !ids.has(n.id) && !n.deleted_at) {
          ids.add(n.id);
          added = true;
        }
      });
    }
    return ids;
  }, [nb, notebooks]);

  const list = useMemo(() => {
    if (!notes) return [];
    let l = notes.filter((n) => !isPurged(n));
    if (view === "trash") l = l.filter((n) => n.deleted_at);
    else {
      l = l.filter((n) => !n.deleted_at);
      l = view === "archive" ? l.filter((n) => n.is_archived) : l.filter((n) => !n.is_archived);
      if (view === "fav") l = l.filter((n) => n.is_favorite);
    }
    if (nb === "none") l = l.filter((n) => !n.notebook_id);
    else if (nbIds) l = l.filter((n) => n.notebook_id && nbIds.has(n.notebook_id));
    if (tag) l = l.filter((n) => n.tags.includes(tag));
    const query = q.trim().toLowerCase();
    if (query) {
      const words = query.split(/\s+/);
      l = l.filter((n) => {
        const hay = `${n.title}\n${n.content}\n${n.tags.join(" ")}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    }
    return l.sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.updated_at.localeCompare(a.updated_at));
  }, [notes, view, nb, nbIds, tag, q]);

  // il quaderno sbloccato si richiude cambiando quaderno o dopo più di un minuto in background
  useEffect(() => {
    setNbUnlock((u) => (u && u.nb !== nb ? null : u));
  }, [nb]);
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 60_000) setNbUnlock(null);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const lockedNb = nb && nb !== "none" ? lockedAncestor(nb, notebooks ?? []) : null;
  const nbOpen = !lockedNb || nbUnlock?.nb === nb;

  // titoli delle note cifrate del quaderno sbloccato
  useEffect(() => {
    if (!nbUnlock || nbUnlock.nb !== nb) return;
    const missing = list.filter((n) => n.is_locked && !nbUnlock.titles.has(n.id));
    if (!missing.length) return;
    void Promise.all(
      missing.map(async (n) => [n.id, await decryptNote(nbUnlock.key, n).then((p) => p.title || "Senza titolo").catch(() => "Nota bloccata")] as const),
    ).then((pairs) => setNbUnlock((u) => (u ? { ...u, titles: new Map([...u.titles, ...pairs]) } : u)));
  }, [list, nbUnlock, nb]);

  const title =
    view === "trash" ? "Cestino" : view === "archive" ? "Archivio" : view === "fav" ? "Preferiti" :
    nb === "none" ? "Senza quaderno" : nb ? nbMap.get(nb)?.name ?? "Quaderno" : tag ? `#${tag}` : "Tutte le note";

  async function semanticSearch() {
    if (!q.trim()) return;
    setSearching(true);
    setErr("");
    try {
      setSemantic(await aiPost<{ terms: string[]; hits: Hit[] }>("search", { query: q }, "ricerca per significato"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  if (!nbOpen) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-10 text-center">
        <Lock size={40} className="text-muted" />
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted">
          {lockedNb && lockedNb.id !== nb ? `Fa parte del quaderno «${lockedNb.name}», protetto da PIN.` : "Questo quaderno è protetto da PIN."} Inseriscilo per vedere le note.
        </p>
        <button className="btn-primary" onClick={() => setAskPin(true)}>
          <LockOpen size={16} /> Sblocca
        </button>
        {askPin && (
          <PinDialog
            onClose={() => setAskPin(false)}
            onKey={(key) => {
              setAskPin(false);
              setNbUnlock({ nb: nb!, key, titles: new Map() });
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 md:py-8">
      <h1 className="mb-4 flex items-center gap-2 text-2xl font-bold">
        {title}
        {lockedNb && <Lock size={18} className="text-muted" aria-label="Protetto da PIN" />}
      </h1>

      {view !== "trash" && (
        <div className="mb-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="input !pl-9 !pr-36"
              placeholder="Cerca nelle note…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSemantic(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && semanticSearch()}
              aria-label="Cerca"
            />
            {q && (
              <button
                className="btn-ghost absolute right-1 top-1/2 -translate-y-1/2 !px-2 !py-1 text-xs text-accent"
                onClick={semanticSearch}
                disabled={searching}
                title="Trova note sullo stesso argomento anche se usano parole diverse (Invio)"
              >
                <Sparkles size={14} /> {searching ? "Cerco…" : "Per significato"}
              </button>
            )}
          </div>
          {err && <p className="mt-2 text-sm text-danger">{err}</p>}
        </div>
      )}

      {semantic && (
        <div className="card mb-6 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">
              <Sparkles size={14} className="mr-1 inline text-accent" />
              Risultati per significato
            </p>
            <button className="btn-icon !h-7 !w-7" onClick={() => setSemantic(null)} aria-label="Chiudi">
              <X size={14} />
            </button>
          </div>
          <p className="mb-2 text-xs text-muted">Termini cercati: {semantic.terms.join(", ")}</p>
          {semantic.hits.length === 0 && <p className="text-sm text-muted">Nessuna nota trovata.</p>}
          <ul className="divide-y divide-line">
            {semantic.hits.map((h) => (
              <li key={h.id}>
                <Link href={`/note?id=${h.id}`} className="block py-2 hover:text-accent">
                  <span className="font-medium">{h.title || "Senza titolo"}</span>
                  <span
                    className="block text-sm text-muted"
                    dangerouslySetInnerHTML={{
                      __html: escapeHtml(h.snippet).replace(/&lt;&lt;/g, "<mark>").replace(/&gt;&gt;/g, "</mark>"),
                    }}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notes === undefined ? null : list.length === 0 ? (
        <EmptyState view={view} />
      ) : (
        <ul className="space-y-2">
          {list.map((n) => (
            <NoteRow
              key={n.id}
              n={n}
              trash={view === "trash"}
              nbName={n.notebook_id ? nbMap.get(n.notebook_id)?.name : undefined}
              shownTitle={nbUnlock?.nb === nb ? nbUnlock.titles.get(n.id) : undefined}
              onOpen={nbUnlock?.nb === nb && n.is_locked ? () => handKey(n.id, nbUnlock.key) : undefined}
            />
          ))}
        </ul>
      )}

      {view === "trash" && list.length > 0 && (
        <button
          className="btn mt-6 text-danger"
          onClick={async () => {
            if (confirm("Svuotare il cestino? Le note verranno eliminate definitivamente.")) for (const n of list) await purgeNote(n.id);
          }}
        >
          <Trash2 size={15} /> Svuota cestino
        </button>
      )}
    </div>
  );
}

function NoteRow({ n, trash, nbName, shownTitle, onOpen }: { n: Note; trash: boolean; nbName?: string; shownTitle?: string; onOpen?: () => void }) {
  const preview = n.is_locked ? "Protetta da PIN" : stripMarkdown(n.content).slice(0, 160);
  const [moving, setMoving] = useState(false);
  return (
    <li className="card group relative p-3 transition hover:border-accent">
      <Link
        href={`/note?id=${n.id}`}
        onClick={onOpen}
        className="block pr-24"
        draggable={!trash}
        onDragStart={(e) => {
          // da PC: trascina la nota su un quaderno della barra laterale
          e.dataTransfer.setData(NOTE_DRAG_TYPE, n.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        title={trash ? undefined : "Trascina su un quaderno per spostarla"}
      >
        <div className="flex items-center gap-1.5">
          {n.is_pinned && <Pin size={13} className="shrink-0 text-accent" />}
          {n.is_locked && <Lock size={13} className="shrink-0 text-muted" />}
          <span className="truncate font-semibold">{shownTitle ?? noteTitle(n)}</span>
          {n.is_favorite && <Star size={13} className="shrink-0 fill-amber-400 text-amber-400" />}
          {n.source?.status === "processing" && <span className="chip shrink-0 !text-accent">⏳ in elaborazione</span>}
          {n.source?.status === "error" && <span className="chip shrink-0 !text-danger">⚠️ errore</span>}
        </div>
        {preview && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{preview}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>{new Date(n.updated_at).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" })}</span>
          {nbName && <span className="chip">{nbName}</span>}
          {n.tags.slice(0, 4).map((t) => (
            <span key={t} className="chip">
              <Hash size={10} />
              {t}
            </span>
          ))}
        </div>
      </Link>
      <div className="absolute right-2 top-2 flex gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100">
        {trash ? (
          <>
            <button className="btn-icon !h-8 !w-8" title="Ripristina" aria-label="Ripristina" onClick={() => restoreNote(n.id)}>
              <Undo2 size={15} />
            </button>
            <button
              className="btn-icon !h-8 !w-8 hover:!text-danger"
              title="Elimina definitivamente"
              aria-label="Elimina definitivamente"
              onClick={() => confirm("Eliminare definitivamente la nota?") && purgeNote(n.id)}
            >
              <Trash2 size={15} />
            </button>
          </>
        ) : (
          <>
            <button className="btn-icon !h-8 !w-8" title="Sposta in quaderno" aria-label="Sposta in quaderno" onClick={() => setMoving(true)}>
              <FolderInput size={15} />
            </button>
            <button
              className="btn-icon !h-8 !w-8"
              title={n.is_pinned ? "Togli dall'alto" : "Fissa in alto"}
              aria-label={n.is_pinned ? "Togli dall'alto" : "Fissa in alto"}
              onClick={() => updateNote(n.id, { is_pinned: !n.is_pinned })}
            >
              <Pin size={15} className={n.is_pinned ? "text-accent" : ""} />
            </button>
            <button
              className="btn-icon !h-8 !w-8"
              title={n.is_archived ? "Togli dall'archivio" : "Archivia"}
              aria-label={n.is_archived ? "Togli dall'archivio" : "Archivia"}
              onClick={() => updateNote(n.id, { is_archived: !n.is_archived })}
            >
              <Archive size={15} />
            </button>
          </>
        )}
      </div>
      {moving && <MoveDialog noteIds={[n.id]} current={n.notebook_id} onClose={() => setMoving(false)} />}
    </li>
  );
}

function EmptyState({ view }: { view: string }) {
  const msg =
    view === "trash" ? "Il cestino è vuoto." : view === "archive" ? "Nessuna nota archiviata." : view === "fav" ? "Nessuna nota preferita." : "Nessuna nota qui.";
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <p className="text-muted">{msg}</p>
      {view === "all" && (
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/note?new=1" className="btn-primary">Scrivi una nota</Link>
          <Link href="/capture" className="btn">Fotografa i tuoi appunti</Link>
          <Link href="/import" className="btn">Importa un PDF</Link>
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

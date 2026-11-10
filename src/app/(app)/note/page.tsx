"use client";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive, ArrowLeft, Columns2, Download, Eye, FileText, Image as ImageIcon, Lock, LockOpen, MoreVertical,
  PenLine, Pin, Share2, Sparkles, Star, Trash2, Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownView } from "@/components/MarkdownView";
import { AiPanel } from "@/components/note/AiPanel";
import { Editor, type EditorHandle } from "@/components/note/Editor";
import { ImageAnnotator } from "@/components/note/ImageAnnotator";
import { JobStatus } from "@/components/note/JobStatus";
import { ShareDialog } from "@/components/note/ShareDialog";
import { TagEditor } from "@/components/note/TagEditor";
import { TeachCorrections } from "@/components/note/TeachCorrections";
import { PinDialog } from "@/components/PinDialog";
import { aiPost } from "@/lib/ai-client";
import { decryptText, encryptText, pinSession } from "@/lib/crypto";
import { db } from "@/lib/db";
import { exportDocx, exportMarkdown, exportPdf } from "@/lib/export";
import { fileUrl } from "@/lib/files";
import { useWikiIndex } from "@/lib/hooks";
import { cropPendingFigures } from "@/lib/jobs-client";
import { extractWikiLinks } from "@/lib/markdown";
import { createNote, createNotebook, noteTitle, restoreNote, trashNote, updateNote } from "@/lib/repo";
import type { Note } from "@/lib/types";

const EMPTY: never[] = [];

type ViewMode = "edit" | "split" | "preview";

export default function NotePage() {
  const sp = useSearchParams();
  const router = useRouter();
  const id = sp.get("id");
  const creating = useRef(false);

  // /note?new=1 → crea la nota e sostituisci l'URL
  useEffect(() => {
    if (sp.get("new") && !creating.current) {
      creating.current = true;
      const nb = sp.get("nb");
      void createNote({ notebook_id: nb && nb !== "none" ? nb : null, content: sp.get("text") ?? "" }).then((n) => router.replace(`/note?id=${n.id}&edit=1`));
    }
  }, [sp, router]);

  const note = useLiveQuery(() => (id ? db.notes.get(id) : undefined), [id]);
  if (!id) return <div className="p-8 text-muted">Creazione nota…</div>;
  if (note === undefined) return <div className="p-8 text-muted">Caricamento…</div>;
  if (!note) return <div className="p-8 text-muted">Nota non trovata. <Link href="/notes" className="text-accent underline">Torna alle note</Link></div>;
  if (note.source?.status) return <JobStatus note={note} />;
  return <NoteEditor key={note.id} note={note} startInEdit={!!sp.get("edit")} />;
}

function NoteEditor({ note, startInEdit }: { note: Note; startInEdit: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.is_locked ? "" : note.content);
  const [unlocked, setUnlocked] = useState(!note.is_locked);
  const [mode, setMode] = useState<ViewMode>(() => {
    if (startInEdit || !note.content) return typeof window !== "undefined" && window.innerWidth >= 1024 ? "split" : "edit";
    return "preview";
  });
  const [aiOpen, setAiOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [share, setShare] = useState(false);
  const [pinFor, setPinFor] = useState<null | "unlock" | "lock" | "remove">(null);
  const [annotate, setAnnotate] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [showOriginals, setShowOriginals] = useState(false);
  const editor = useRef<EditorHandle>(null);
  const dirty = useRef(false);
  const lastSaved = useRef({ title: note.title, content: note.content });

  const notebooks = useLiveQuery(() => db.notebooks.toArray(), []) ?? [];
  const allNotes = useLiveQuery(() => db.notes.toArray(), []) ?? EMPTY;
  const wikiIndex = useWikiIndex();
  const allTags = useMemo(() => [...new Set(allNotes.flatMap((n) => n.tags))].sort(), [allNotes]);
  const titles = useMemo(
    () => allNotes.filter((n) => !n.deleted_at && n.id !== note.id).map((n) => noteTitle(n)),
    [allNotes, note.id],
  );
  const backlinks = useMemo(() => {
    const me = noteTitle({ title, content }).toLowerCase();
    return allNotes.filter((n) => n.id !== note.id && !n.deleted_at && !n.is_locked && extractWikiLinks(n.content).includes(me));
  }, [allNotes, note.id, title, content]);

  // figure indicate dall'AI durante la trascrizione: ritagliate dalle foto originali
  useEffect(() => {
    if (note.source?.figures?.length) void cropPendingFigures(note);
  }, [note]);

  // decifra se la chiave è già in memoria
  useEffect(() => {
    if (note.is_locked && pinSession.get() && note.locked_payload) {
      decryptText(pinSession.get()!, note.locked_payload)
        .then((t) => {
          setContent(t);
          lastSaved.current.content = t;
          setUnlocked(true);
        })
        .catch(() => {});
    }
  }, [note.is_locked, note.locked_payload]);

  // aggiornamenti arrivati da un altro dispositivo mentre la nota è aperta (se non ci sono modifiche locali)
  useEffect(() => {
    if (dirty.current || note.is_locked) return;
    if (note.content !== lastSaved.current.content || note.title !== lastSaved.current.title) {
      setTitle(note.title);
      setContent(note.content);
      lastSaved.current = { title: note.title, content: note.content };
    }
  }, [note.content, note.title, note.is_locked]);

  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    if (note.is_locked) {
      const key = pinSession.get();
      if (!key) return;
      await updateNote(note.id, { title, locked_payload: await encryptText(key, content), content: "" });
    } else {
      await updateNote(note.id, { title, content });
    }
    lastSaved.current = { title, content };
  }, [note.id, note.is_locked, title, content]);

  // salvataggio automatico
  useEffect(() => {
    if (title === lastSaved.current.title && content === lastSaved.current.content) return;
    dirty.current = true;
    const t = setTimeout(() => void save(), 600);
    return () => clearTimeout(t);
  }, [title, content, save]);

  useEffect(() => {
    const flush = () => void save();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [save]);

  async function suggestTags() {
    if (note.is_locked) return alert("Le note bloccate non vengono mai inviate all'AI.");
    setSuggesting(true);
    try {
      const nbs = notebooks.filter((n) => !n.deleted_at);
      const r = await aiPost<{ tags: string[]; notebook: string }>(
        "tags",
        { title, content, existingTags: allTags, notebooks: nbs.map((n) => n.name) },
        "suggerimento tag",
      );
      const merged = [...new Set([...note.tags, ...r.tags.map((t) => t.toLowerCase().replace(/^#/, ""))])];
      const patch: Partial<Note> = { tags: merged };
      if (!note.notebook_id && r.notebook) {
        const match = nbs.find((n) => n.name.toLowerCase() === r.notebook.toLowerCase());
        if (match && confirm(`Spostare la nota nel quaderno "${match.name}"?`)) patch.notebook_id = match.id;
      }
      await updateNote(note.id, patch);
    } catch (e) {
      if ((e as Error).message !== "Annullato") alert((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  async function onPin(key: CryptoKey) {
    const action = pinFor;
    setPinFor(null);
    if (action === "unlock") {
      try {
        const t = note.locked_payload ? await decryptText(key, note.locked_payload) : "";
        setContent(t);
        lastSaved.current.content = t;
        setUnlocked(true);
      } catch {
        alert("Impossibile decifrare la nota con questo PIN.");
      }
    } else if (action === "lock") {
      await lockWith(key);
    } else if (action === "remove") {
      const t = note.locked_payload ? await decryptText(key, note.locked_payload) : content;
      await updateNote(note.id, { is_locked: false, locked_payload: null, content: t });
      lastSaved.current.content = t;
      setContent(t);
      setUnlocked(true);
    }
  }

  async function lockWith(key: CryptoKey) {
    dirty.current = false;
    await updateNote(note.id, {
      title,
      is_locked: true,
      locked_payload: await encryptText(key, content),
      content: "",
      share_mode: null,
      share_token: null,
    });
  }

  async function createLinkedNote(t: string) {
    const n = await createNote({ title: t, notebook_id: note.notebook_id });
    router.push(`/note?id=${n.id}&edit=1`);
  }

  const trashed = !!note.deleted_at;
  const activeNbs = notebooks.filter((n) => !n.deleted_at).sort((a, b) => a.name.localeCompare(b.name));

  if (note.is_locked && !unlocked) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-10 text-center">
        <Lock size={40} className="text-muted" />
        <h1 className="text-xl font-semibold">{note.title || "Nota bloccata"}</h1>
        <p className="text-sm text-muted">Questa nota è cifrata. Inserisci il PIN per leggerla.</p>
        <button className="btn-primary" onClick={() => setPinFor("unlock")}>
          <LockOpen size={16} /> Sblocca
        </button>
        <Link href="/notes" className="text-sm text-accent">Torna alle note</Link>
        {pinFor && <PinDialog onKey={onPin} onClose={() => setPinFor(null)} />}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* intestazione */}
        <header className="no-print sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
          <div className="flex items-center gap-1 px-2 py-2 md:px-4">
            <button className="btn-icon md:hidden" onClick={() => router.back()} aria-label="Indietro">
              <ArrowLeft size={18} />
            </button>
            <div className="flex rounded-lg border border-line bg-panel p-0.5" role="tablist" aria-label="Modalità di visualizzazione">
              <ModeBtn active={mode === "edit"} onClick={() => setMode("edit")} icon={<PenLine size={15} />} label="Modifica" />
              <span className="hidden lg:contents">
                <ModeBtn active={mode === "split"} onClick={() => setMode("split")} icon={<Columns2 size={15} />} label="Diviso" />
              </span>
              <ModeBtn active={mode === "preview"} onClick={() => setMode("preview")} icon={<Eye size={15} />} label="Leggi" />
            </div>
            <div className="flex-1" />
            {trashed ? (
              <button className="btn" onClick={() => restoreNote(note.id)}>
                <Undo2 size={15} /> Ripristina
              </button>
            ) : (
              <>
                <button
                  className="btn-icon"
                  onClick={() => updateNote(note.id, { is_favorite: !note.is_favorite })}
                  aria-label={note.is_favorite ? "Togli dai preferiti" : "Aggiungi ai preferiti"}
                  title="Preferito"
                >
                  <Star size={18} className={note.is_favorite ? "fill-amber-400 text-amber-400" : ""} />
                </button>
                <button className="btn-icon" onClick={() => setShare(true)} aria-label="Condividi" title="Condividi">
                  <Share2 size={18} className={note.share_mode ? "text-accent" : ""} />
                </button>
                <button
                  className={`btn !px-2.5 ${aiOpen ? "!border-accent !text-accent" : ""}`}
                  onClick={() => setAiOpen(!aiOpen)}
                  aria-label="Assistente AI"
                  disabled={note.is_locked}
                  title={note.is_locked ? "Le note bloccate non vengono mai inviate all'AI" : "Assistente AI"}
                >
                  <Sparkles size={16} className="text-accent" />
                  <span className="hidden sm:inline">AI</span>
                </button>
              </>
            )}
            <div className="relative">
              <button className="btn-icon" onClick={() => setMenu(!menu)} aria-label="Altre azioni" aria-expanded={menu}>
                <MoreVertical size={18} />
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
                  <div className="card absolute right-0 top-full z-40 mt-1 w-60 overflow-hidden py-1 shadow-xl" role="menu" onClick={() => setMenu(false)}>
                    <MenuItem icon={<Pin size={15} />} label={note.is_pinned ? "Togli dall'alto" : "Fissa in alto"} onClick={() => updateNote(note.id, { is_pinned: !note.is_pinned })} />
                    <MenuItem icon={<Archive size={15} />} label={note.is_archived ? "Togli dall'archivio" : "Archivia"} onClick={() => updateNote(note.id, { is_archived: !note.is_archived })} />
                    {note.is_locked ? (
                      <MenuItem icon={<LockOpen size={15} />} label="Rimuovi blocco PIN" onClick={() => setPinFor("remove")} />
                    ) : (
                      <MenuItem icon={<Lock size={15} />} label="Blocca con PIN" onClick={() => {
                        const key = pinSession.get();
                        if (key) void lockWith(key);
                        else setPinFor("lock");
                      }} />
                    )}
                    <div className="my-1 border-t border-line" />
                    <MenuItem icon={<FileText size={15} />} label="Esporta PDF" onClick={async () => { await save(); exportPdf(note); }} />
                    <MenuItem icon={<Download size={15} />} label="Esporta Word (.docx)" onClick={() => exportDocx({ ...note, title, content })} />
                    <MenuItem icon={<Download size={15} />} label="Esporta Markdown" onClick={() => exportMarkdown({ ...note, title, content })} />
                    {!trashed && (
                      <>
                        <div className="my-1 border-t border-line" />
                        <MenuItem
                          icon={<Trash2 size={15} />}
                          label="Sposta nel cestino"
                          danger
                          onClick={async () => {
                            await trashNote(note.id);
                            router.push("/notes");
                          }}
                        />
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-6xl flex-1 px-3 pb-10 md:px-6">
          {trashed && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Questa nota è nel cestino.</p>}

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titolo"
            className="mt-4 w-full bg-transparent text-2xl font-bold outline-none placeholder:text-muted md:text-3xl"
            aria-label="Titolo"
          />

          <div className="no-print mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <select
              className="rounded-lg border border-line bg-panel px-2 py-1 text-xs"
              value={note.notebook_id ?? ""}
              onChange={async (e) => {
                if (e.target.value === "__new") {
                  const name = prompt("Nome del nuovo quaderno");
                  if (name?.trim()) {
                    const nb = await createNotebook(name.trim());
                    await updateNote(note.id, { notebook_id: nb.id });
                  }
                } else await updateNote(note.id, { notebook_id: e.target.value || null });
              }}
              aria-label="Quaderno"
            >
              <option value="">Senza quaderno</option>
              {activeNbs.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
              <option value="__new">+ Nuovo quaderno…</option>
            </select>
            <TagEditor tags={note.tags} onChange={(tags) => updateNote(note.id, { tags })} allTags={allTags} onSuggest={suggestTags} suggesting={suggesting} />
            {note.is_locked && <span className="chip"><Lock size={11} /> Cifrata</span>}
          </div>

          {!note.is_locked && <TeachCorrections note={note} content={content} />}

          <div className={`mt-4 grid gap-4 ${mode === "split" ? "lg:grid-cols-2" : ""}`}>
            {(mode === "edit" || mode === "split") && (
              <div className="card overflow-hidden">
                <Editor ref={editor} value={content} onChange={setContent} noteTitles={titles} noteId={note.id} />
              </div>
            )}
            {(mode === "preview" || mode === "split") && (
              <div className={mode === "split" ? "card max-h-[80vh] overflow-y-auto p-4" : "py-1"}>
                {content.trim() ? (
                  <MarkdownView
                    content={content}
                    wikiIndex={wikiIndex}
                    onMissingLink={createLinkedNote}
                    onImageClick={(src) => !trashed && setAnnotate(src)}
                  />
                ) : (
                  <button className="text-muted" onClick={() => setMode("edit")}>Nota vuota: tocca per scrivere…</button>
                )}
              </div>
            )}
          </div>

          {note.source?.files && note.source.files.length > 0 && note.source.type === "photo" && (
            <div className="no-print mt-6">
              <button className="flex items-center gap-1.5 text-sm text-muted hover:text-fg" onClick={() => setShowOriginals(!showOriginals)}>
                <ImageIcon size={15} /> Foto originali ({note.source.files.length}) {showOriginals ? "▴" : "▾"}
              </button>
              {showOriginals && (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {note.source.files.map((f) => (
                    <a key={f} href={fileUrl(f)} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fileUrl(f)} alt="Foto originale" className="aspect-[3/4] w-full rounded-lg object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {backlinks.length > 0 && (
            <div className="no-print mt-8 border-t border-line pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Note che rimandano a questa ({backlinks.length})</p>
              <div className="flex flex-wrap gap-2">
                {backlinks.map((b) => (
                  <Link key={b.id} href={`/note?id=${b.id}`} className="chip !px-3 !py-1 !text-sm hover:!text-accent">
                    {noteTitle(b)}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <p className="no-print mt-6 text-xs text-muted">
            Modificata il {new Date(note.updated_at).toLocaleString("it-IT")} · Creata il {new Date(note.created_at).toLocaleDateString("it-IT")}
          </p>
        </div>
      </div>

      {/* pannello AI: laterale su desktop, a schermo intero su mobile */}
      {aiOpen && !note.is_locked && (
        <div className="no-print fixed inset-0 z-40 md:static md:inset-auto md:z-auto md:w-96 md:shrink-0 md:border-l md:border-line">
          <div className="sticky top-0 h-dvh md:h-[100dvh]">
            <AiPanel
              content={content}
              getSelection={() => editor.current?.getSelection() || window.getSelection()?.toString() || ""}
              onApply={(next) => setContent(next)}
              onClose={() => setAiOpen(false)}
            />
          </div>
        </div>
      )}

      {share && <ShareDialog note={note} onClose={() => setShare(false)} />}
      {pinFor && <PinDialog onKey={onPin} onClose={() => setPinFor(null)} />}
      {annotate && (
        <ImageAnnotator
          src={annotate}
          noteId={note.id}
          onClose={() => setAnnotate(null)}
          onSave={(newSrc) => {
            setContent((c) => c.replace(annotate, newSrc));
            setAnnotate(null);
          }}
        />
      )}
    </div>
  );
}

function ModeBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${active ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel-2 ${danger ? "text-danger" : ""}`}>
      {icon}
      {label}
    </button>
  );
}

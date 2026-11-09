"use client";
import { MessageSquare, PenLine, Save } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { MarkdownView } from "@/components/MarkdownView";
import { supabase } from "@/lib/supabase/client";

type Shared = { id: string; title: string; content: string; share_mode: "view" | "edit"; updated_at: string };
type Comment = { id: string; author_name: string; quote: string | null; body: string; created_at: string };

function SharedInner() {
  const token = useSearchParams().get("t") ?? "";
  const [note, setNote] = useState<Shared | null | undefined>(undefined);
  const [comments, setComments] = useState<Comment[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [quote, setQuote] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const { data } = await supabase().rpc("get_shared_note", { p_token: token }).maybeSingle<Shared>();
    setNote(data ?? null);
    if (data) setDraft(data.content);
    const { data: c } = await supabase().rpc("list_shared_comments", { p_token: token });
    setComments((c as Comment[]) ?? []);
  }
  useEffect(() => {
    setName(localStorage.getItem("commentName") || "");
    if (token) void load();
    else setNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function saveEdit() {
    const { error } = await supabase().rpc("update_shared_note", { p_token: token, p_content: draft });
    if (error) return setMsg(error.message);
    setEditing(false);
    setMsg("Modifiche salvate ✓");
    void load();
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    localStorage.setItem("commentName", name);
    const { error } = await supabase().rpc("add_shared_comment", { p_token: token, p_author: name, p_quote: quote, p_body: body });
    if (error) return setMsg(error.message);
    setBody("");
    setQuote("");
    void load();
  }

  if (note === undefined) return <p className="p-8 text-muted">Caricamento…</p>;
  if (note === null) return <p className="p-8 text-muted">Questo link non è valido o è stato disattivato.</p>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <h1 className="text-3xl font-bold">{note.title || "Nota condivisa"}</h1>
        {note.share_mode === "edit" && !editing && (
          <button className="btn shrink-0" onClick={() => setEditing(true)}>
            <PenLine size={15} /> Modifica
          </button>
        )}
      </div>
      {msg && <p className="mb-3 text-sm text-ok">{msg}</p>}
      {editing ? (
        <div className="space-y-2">
          <textarea className="input min-h-[60vh] font-mono" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Contenuto" />
          <div className="flex gap-2">
            <button className="btn-primary" onClick={saveEdit}><Save size={15} /> Salva</button>
            <button className="btn" onClick={() => { setEditing(false); setDraft(note.content); }}>Annulla</button>
          </div>
        </div>
      ) : (
        <div onMouseUp={() => { const s = window.getSelection()?.toString().trim(); if (s) setQuote(s.slice(0, 500)); }}>
          <MarkdownView content={note.content} shareToken={token} />
        </div>
      )}

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><MessageSquare size={16} /> Commenti ({comments.length})</h2>
        <ul className="mb-4 space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="card p-3 text-sm">
              <p className="text-xs text-muted"><b>{c.author_name}</b> · {new Date(c.created_at).toLocaleString("it-IT")}</p>
              {c.quote && <p className="my-1 border-l-2 border-accent pl-2 text-xs italic text-muted">{c.quote}</p>}
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
        <form className="card space-y-2 p-3" onSubmit={addComment}>
          {quote && (
            <p className="flex items-start gap-2 border-l-2 border-accent pl-2 text-xs italic text-muted">
              <span className="flex-1">«{quote}»</span>
              <button type="button" onClick={() => setQuote("")} className="not-italic">✕</button>
            </p>
          )}
          <input className="input" placeholder="Il tuo nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Nome" />
          <textarea className="input" placeholder="Scrivi un commento (seleziona del testo nella nota per citarlo)" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} aria-label="Commento" />
          <button className="btn-primary">Invia commento</button>
        </form>
      </section>
    </div>
  );
}

export default function SharedPage() {
  return (
    <Suspense>
      <SharedInner />
    </Suspense>
  );
}

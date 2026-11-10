"use client";
import { Copy, Link2Off, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { updateNote } from "@/lib/repo";
import { detectSecrets } from "@/lib/secrets";
import { supabase } from "@/lib/supabase/client";
import type { Note } from "@/lib/types";
import { Modal } from "../Modal";

type Comment = { id: string; author_name: string; quote: string | null; body: string; created_at: string };

export function ShareDialog({ note, onClose }: { note: Note; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const url = note.share_token ? `${location.origin}/s?t=${note.share_token}` : "";

  useEffect(() => {
    supabase()
      .from("comments")
      .select("id,author_name,quote,body,created_at")
      .eq("note_id", note.id)
      .order("created_at")
      .then(({ data }) => setComments((data as Comment[]) ?? []));
  }, [note.id]);

  async function setMode(mode: "view" | "edit" | null) {
    const token = mode ? note.share_token ?? randomToken() : null;
    await updateNote(note.id, { share_mode: mode, share_token: token });
  }

  return (
    <Modal title="Condividi nota" onClose={onClose}>
      {note.is_locked ? (
        <p className="text-sm text-muted">Le note bloccate con PIN non possono essere condivise.</p>
      ) : (
        <div className="space-y-4">
          {detectSecrets(note.content).length > 0 && (
            <p className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              ⚠️ Questa nota contiene password, token o chiavi: chi ha il link potrà leggerli. Mascherali prima di condividerla.
            </p>
          )}
          <div className="space-y-2">
            <p className="text-sm font-medium">Chi ha il link può:</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                [null, "Nessuno"],
                ["view", "Leggere e commentare"],
                ["edit", "Modificare"],
              ] as const).map(([m, label]) => (
                <button
                  key={label}
                  onClick={() => setMode(m)}
                  className={`btn !py-2 text-xs ${note.share_mode === m ? "!border-accent !bg-accent-soft !text-accent" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {url && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input className="input text-xs" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Link di condivisione" />
                <button
                  className="btn shrink-0"
                  onClick={async () => {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  <Copy size={14} /> {copied ? "Copiato" : "Copia"}
                </button>
              </div>
              {"share" in navigator && (
                <button className="btn w-full" onClick={() => navigator.share({ title: note.title, url }).catch(() => {})}>
                  Condividi con…
                </button>
              )}
              <button className="btn w-full text-danger" onClick={async () => { await updateNote(note.id, { share_token: null, share_mode: null }); }}>
                <Link2Off size={14} /> Disattiva e invalida il link
              </button>
              <p className="text-xs text-muted">Il link diventa attivo dopo la sincronizzazione. Le immagini sono visibili solo se sul server è impostata la chiave di servizio di Supabase.</p>
            </div>
          )}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <MessageSquare size={14} /> Commenti ricevuti ({comments.length})
            </p>
            {comments.length === 0 && <p className="text-sm text-muted">Nessun commento.</p>}
            <ul className="space-y-2">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-panel-2 p-2 text-sm">
                  <p className="text-xs text-muted">
                    <b>{c.author_name}</b> · {new Date(c.created_at).toLocaleString("it-IT")}
                  </p>
                  {c.quote && <p className="my-1 border-l-2 border-accent pl-2 text-xs italic text-muted">{c.quote}</p>}
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
}

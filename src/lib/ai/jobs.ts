import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import type { NoteSource } from "@/lib/types";
import { aiErrorInfo } from "./gemini";

export const NOTE_COLS =
  "id,notebook_id,title,content,tags,is_favorite,is_pinned,is_archived,is_locked,locked_payload,source,share_token,share_mode,created_at,updated_at,deleted_at";

type JobResult = { title: string; content: string; tags: string[]; source?: Partial<NoteSource> };

/**
 * Crea (o reimposta) subito la nota con stato "in elaborazione" e risponde al browser;
 * il lavoro AI continua sul server anche se l'utente chiude l'app. Il risultato arriva
 * sul dispositivo tramite la sincronizzazione in tempo reale.
 */
export async function startNoteJob(opts: {
  sb: SupabaseClient;
  userId: string;
  noteId: string;
  notebookId: string | null;
  placeholderTitle: string;
  source: NoteSource;
  work: () => Promise<JobResult>;
  onSuccess?: () => Promise<void>;
}) {
  const { sb, userId, noteId } = opts;
  const now = new Date().toISOString();
  const { data: existing } = await sb.from("notes").select("id,created_at,notebook_id").eq("id", noteId).maybeSingle();
  const row = {
    id: noteId,
    user_id: userId,
    notebook_id: existing ? existing.notebook_id : opts.notebookId,
    title: opts.placeholderTitle,
    content: "",
    tags: [],
    source: { ...opts.source, status: "processing" },
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
  };
  const { data: note, error } = await sb.from("notes").upsert(row).select(NOTE_COLS).single();
  if (error) throw new Error(`Impossibile creare la nota: ${error.message}`);

  after(async () => {
    try {
      const r = await opts.work();
      const { status: _s, error: _e, error_code: _c, ...rest } = { ...opts.source, ...r.source };
      void _s; void _e; void _c;
      const { error: upErr } = await sb
        .from("notes")
        .update({ title: r.title, content: r.content, tags: r.tags, source: rest, updated_at: new Date().toISOString() })
        .eq("id", noteId);
      if (upErr) throw new Error(upErr.message);
      await opts.onSuccess?.();
    } catch (e) {
      const info = aiErrorInfo(e);
      await sb
        .from("notes")
        .update({
          source: { ...opts.source, status: "error", error: info.message, ...(info.code ? { error_code: info.code } : {}) },
          updated_at: new Date().toISOString(),
        })
        .eq("id", noteId);
    }
  });

  return note;
}

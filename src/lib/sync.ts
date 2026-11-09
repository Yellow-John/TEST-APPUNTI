"use client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { db, nowIso } from "./db";
import { supabase } from "./supabase/client";
import type { Note, Notebook } from "./types";

type Table = "notes" | "notebooks";
type SyncState = "idle" | "syncing" | "offline" | "error";

const listeners = new Set<(s: SyncState) => void>();
let state: SyncState = "idle";
function setState(s: SyncState) {
  state = s;
  listeners.forEach((l) => l(s));
}
export function onSyncState(l: (s: SyncState) => void) {
  listeners.add(l);
  l(state);
  return () => {
    listeners.delete(l);
  };
}

const NOTE_COLS =
  "id,notebook_id,title,content,tags,is_favorite,is_pinned,is_archived,is_locked,locked_payload,source,share_token,share_mode,created_at,updated_at,deleted_at,server_updated_at";
const NB_COLS = "id,parent_id,name,color,position,created_at,updated_at,deleted_at,server_updated_at";

/** Accoda una riga modificata localmente per l'invio al server. */
export async function enqueue(table: Table, rowId: string) {
  const exists = await db.outbox.where({ table, rowId }).first();
  if (!exists) await db.outbox.add({ table, rowId, queued_at: nowIso() });
  scheduleSync();
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSync(delay = 800) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

let running = false;
let again = false;

export async function syncNow() {
  if (running) {
    again = true;
    return;
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setState("offline");
    return;
  }
  const {
    data: { session },
  } = await supabase().auth.getSession();
  if (!session) return;

  running = true;
  setState("syncing");
  try {
    await push();
    await pull("notebooks");
    await pull("notes");
    setState("idle");
  } catch (e) {
    console.error("sync error", e);
    setState(navigator.onLine ? "error" : "offline");
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleSync(100);
    }
  }
}

async function push() {
  const items = await db.outbox.toArray();
  for (const table of ["notebooks", "notes"] as Table[]) {
    const ids = items.filter((i) => i.table === table).map((i) => i.rowId);
    if (!ids.length) continue;
    const rows =
      table === "notes"
        ? await db.notes.bulkGet(ids)
        : await db.notebooks.bulkGet(ids);
    const payload = rows.filter(Boolean);
    if (payload.length) {
      const { error } = await supabase().from(table).upsert(payload as object[]);
      if (error) throw error;
    }
    const done = items.filter((i) => i.table === table).map((i) => i.id!);
    await db.outbox.bulkDelete(done);
  }
}

async function pull(table: Table) {
  const key = `cursor:${table}`;
  const cursor = (await db.meta.get(key))?.value ?? "1970-01-01T00:00:00Z";
  let last = cursor;
  // pagine da 500 righe
  for (;;) {
    const { data, error } = await supabase()
      .from(table)
      .select(table === "notes" ? NOTE_COLS : NB_COLS)
      .gt("server_updated_at", last)
      .order("server_updated_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    const rows = (data ?? []) as unknown as (Record<string, unknown> & { server_updated_at: string })[];
    if (!rows.length) break;
    await applyRemote(table, rows);
    last = rows[rows.length - 1].server_updated_at;
    await db.meta.put({ key, value: last });
    if (rows.length < 500) break;
  }
}

/** Applica righe remote solo se più recenti (o uguali) di quelle locali e non in attesa di invio. */
async function applyRemote(table: Table, rows: Record<string, unknown>[]) {
  const pending = new Set(
    (await db.outbox.where("table").equals(table).toArray()).map((i) => i.rowId),
  );
  await db.transaction("rw", db.notes, db.notebooks, async () => {
    for (const r of rows) {
      const { server_updated_at: _s, ...row } = r;
      void _s;
      const id = row.id as string;
      const local =
        table === "notes" ? await db.notes.get(id) : await db.notebooks.get(id);
      if (local && pending.has(id) && local.updated_at > (row.updated_at as string)) continue;
      if (local && local.updated_at > (row.updated_at as string)) continue;
      if (table === "notes") await db.notes.put(row as unknown as Note);
      else await db.notebooks.put(row as unknown as Notebook);
    }
  });
}

let channel: RealtimeChannel | null = null;
let started = false;

/** Avvia la sincronizzazione continua (realtime + riconnessione). */
export function startSync(userId: string) {
  if (started) return;
  started = true;
  void syncNow();
  window.addEventListener("online", () => void syncNow());
  window.addEventListener("offline", () => setState("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  channel = supabase()
    .channel("appunti-sync")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notes", filter: `user_id=eq.${userId}` },
      () => scheduleSync(300),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notebooks", filter: `user_id=eq.${userId}` },
      () => scheduleSync(300),
    )
    .subscribe();
  // rete di sicurezza: sincronizza ogni 60s
  setInterval(() => void syncNow(), 60_000);
}

export async function stopSyncAndClear() {
  if (channel) await supabase().removeChannel(channel);
  channel = null;
  started = false;
  await db.delete();
  await db.open();
}

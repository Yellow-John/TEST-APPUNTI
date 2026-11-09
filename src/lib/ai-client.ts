"use client";
import { supabase } from "./supabase/client";

let confirmCache: { value: boolean; at: number } | null = null;

async function needsConfirm(): Promise<boolean> {
  if (confirmCache && Date.now() - confirmCache.at < 60_000) return confirmCache.value;
  const { data } = await supabase().from("user_settings").select("confirm_before_ai").maybeSingle();
  confirmCache = { value: !!data?.confirm_before_ai, at: Date.now() };
  return confirmCache.value;
}
export function invalidateAiSettings() {
  confirmCache = null;
}

export class AiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/** Chiama un endpoint AI; chiede conferma se l'utente l'ha impostato. */
export async function aiPost<T>(endpoint: string, body: unknown, label: string): Promise<T> {
  if (!navigator.onLine) throw new Error("Serve una connessione a Internet per usare l'AI.");
  if ((await needsConfirm()) && !window.confirm(`Avviare l'elaborazione AI: ${label}?\n(Usa la quota gratuita giornaliera di Gemini.)`)) {
    throw new Error("Annullato");
  }
  const res = await fetch(`/api/ai/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `Errore ${res.status}` }));
  if (!res.ok) throw new AiError(data.error || `Errore ${res.status}`, res.status, data.code);
  return data as T;
}

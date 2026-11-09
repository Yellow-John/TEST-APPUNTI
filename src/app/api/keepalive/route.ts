import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

// Chiamata una volta al giorno dal cron di Vercel: una piccola query evita che
// il progetto Supabase gratuito venga messo in pausa dopo 7 giorni di inattività.
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { error } = await sb.rpc("get_shared_note", { p_token: "keepalive" });
  return Response.json({ ok: !error, at: new Date().toISOString(), error: error?.message });
}

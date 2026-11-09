import { NextResponse } from "next/server";
import { supabaseServer } from "./supabase/server";

/** Verifica che la richiesta provenga dall'utente autenticato (e, se impostato, dall'unica email ammessa). */
export async function requireUser() {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Non autenticato" }, { status: 401 }) } as const;
  }
  const allowed = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (allowed && user.email?.toLowerCase() !== allowed) {
    return { error: NextResponse.json({ error: "Utente non autorizzato" }, { status: 403 }) } as const;
  }
  return { sb, user } as const;
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

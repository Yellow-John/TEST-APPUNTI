import type { SupabaseClient } from "@supabase/supabase-js";

const STOP = new Set(
  "il lo la i gli le un uno una di a da in con su per tra fra e o ma che chi cosa come dove quando perché perche del della dei delle degli al alla ai alle nel nella nei nelle sul sulla è sono non mi ti si ci vi cos qual quale quali quanto questo questa quello quella mio mia miei mie tuo tua".split(
    " ",
  ),
);

/** Costruisce una tsquery in OR, con ricerca per prefisso, da una lista di termini. */
export function toTsQuery(terms: string[]): string {
  const clean = terms
    .flatMap((t) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u))
    .filter((t) => t.length > 2 && !STOP.has(t))
    .slice(0, 20);
  return [...new Set(clean)].map((t) => `${t}:*`).join(" | ");
}

export type Hit = { id: string; title: string; snippet: string; rank: number };

export async function ftsSearch(sb: SupabaseClient, terms: string[], limit = 20): Promise<Hit[]> {
  const q = toTsQuery(terms);
  if (!q) return [];
  const { data, error } = await sb.rpc("search_notes", { p_query: q, p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as Hit[];
}

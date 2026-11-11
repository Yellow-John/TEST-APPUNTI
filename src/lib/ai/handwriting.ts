import type { SupabaseClient } from "@supabase/supabase-js";
import { type HandwritingProfile, PROFILE_FILE, emptyProfile, parseProfile } from "@/lib/types";
import { type Part, blobToInlinePart } from "./gemini";

const MAX_SAMPLES = 3;
const MAX_TERMS = 500;

export async function loadProfile(sb: SupabaseClient, userId: string): Promise<HandwritingProfile> {
  const { data } = await sb.storage.from("files").download(`${userId}/${PROFILE_FILE}`);
  if (!data) return emptyProfile();
  return parseProfile(await data.text());
}

/** Testo del dizionario personale da aggiungere a un prompt (vuoto se non ci sono termini). */
export function dictionaryText(profile: HandwritingProfile): string {
  const terms = (profile.terms ?? []).slice(0, MAX_TERMS);
  if (!terms.length) return "";
  return `=== DIZIONARIO PERSONALE DELL'UTENTE ===\nParole, nomi, sigle e termini che l'utente scrive spesso. Quando una parola scritta a mano è ambigua e somiglia a uno di questi, usa la grafia indicata qui:\n${terms.join(", ")}`;
}

/** Parti da anteporre alle foto da trascrivere: dizionario personale e campioni della grafia con la loro trascrizione. */
export async function handwritingParts(sb: SupabaseClient, userId: string): Promise<Part[]> {
  const profile = await loadProfile(sb, userId);
  const parts: Part[] = [];
  const dict = dictionaryText(profile);
  if (dict) parts.push({ text: dict });
  const samples = profile.samples.slice(0, MAX_SAMPLES);
  if (samples.length) {
    parts.push({
      text: "=== CAMPIONI DELLA GRAFIA DELL'UTENTE (solo riferimento: NON trascriverli) ===\nUsali per capire come l'utente scrive ogni lettera, maiuscola e minuscola, in stampatello e in corsivo.",
    });
    for (const [i, smp] of samples.entries()) {
      const { data } = await sb.storage.from("files").download(smp.path);
      if (!data) continue;
      parts.push({ text: `Campione ${i + 1} — contenuto corretto: ${smp.description || "(non indicato)"}` });
      parts.push(await blobToInlinePart(data, mimeFromPath(smp.path)));
    }
  }
  if (parts.length) parts.push({ text: "=== FOTO DA TRASCRIVERE ===" });
  return parts;
}

/** Tipo dell'immagine dall'estensione (le foto sono WebP, o JPEG sui browser senza WebP). */
export function mimeFromPath(path: string) {
  return /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.png$/i.test(path) ? "image/png" : "image/webp";
}

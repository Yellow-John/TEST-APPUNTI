import type { SupabaseClient } from "@supabase/supabase-js";
import { type HandwritingProfile, PROFILE_FILE, emptyProfile } from "@/lib/types";
import { type Part, blobToInlinePart } from "./gemini";

const MAX_SAMPLES = 3;
const MAX_CORRECTIONS = 80;

export async function loadProfile(sb: SupabaseClient, userId: string): Promise<HandwritingProfile> {
  const { data } = await sb.storage.from("files").download(`${userId}/${PROFILE_FILE}`);
  if (!data) return emptyProfile();
  try {
    return { ...emptyProfile(), ...(JSON.parse(await data.text()) as Partial<HandwritingProfile>) };
  } catch {
    return emptyProfile();
  }
}

/**
 * Parti da anteporre alle foto da trascrivere: i campioni della grafia con la loro trascrizione,
 * le note dell'utente, il dizionario personale e gli errori di lettura corretti in passato.
 */
export async function handwritingParts(sb: SupabaseClient, userId: string): Promise<Part[]> {
  const profile = await loadProfile(sb, userId);
  const parts: Part[] = [];
  const samples = profile.samples.slice(0, MAX_SAMPLES);
  if (samples.length) {
    parts.push({
      text: "=== CAMPIONI DELLA GRAFIA DELL'UTENTE (solo riferimento: NON trascriverli) ===\nUsali per capire come l'utente scrive ogni lettera, maiuscola e minuscola, in stampatello e in corsivo.",
    });
    for (const [i, smp] of samples.entries()) {
      const { data } = await sb.storage.from("files").download(smp.path);
      if (!data) continue;
      parts.push({ text: `Campione ${i + 1} — contenuto corretto: ${smp.description || "(non indicato)"}` });
      parts.push(await blobToInlinePart(data, "image/webp"));
    }
  }
  const extra: string[] = [];
  if (profile.notes.trim()) extra.push(`Osservazioni dell'utente sulla propria grafia: ${profile.notes.trim()}`);
  if (profile.glossary.length) {
    extra.push(`Parole, nomi e sigle che l'utente usa spesso (scrivili esattamente così quando li riconosci): ${profile.glossary.slice(0, 200).join(", ")}`);
  }
  const corr = profile.corrections.slice(-MAX_CORRECTIONS);
  if (corr.length) {
    extra.push(`Errori di lettura fatti in passato sulla grafia di questo utente (a sinistra cosa era stato letto, a destra la parola giusta):\n${corr.map((c) => `«${c.wrong}» → «${c.right}»`).join("\n")}`);
  }
  if (extra.length) parts.push({ text: `=== INFORMAZIONI SULLA GRAFIA DELL'UTENTE ===\n${extra.join("\n\n")}` });
  if (parts.length) parts.push({ text: "=== FOTO DA TRASCRIVERE ===" });
  return parts;
}

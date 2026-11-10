import type { SupabaseClient } from "@supabase/supabase-js";
import { type HandwritingProfile, PROFILE_FILE, emptyProfile } from "@/lib/types";
import { type Part, blobToInlinePart } from "./gemini";

const MAX_SAMPLES = 3;

export async function loadProfile(sb: SupabaseClient, userId: string): Promise<HandwritingProfile> {
  const { data } = await sb.storage.from("files").download(`${userId}/${PROFILE_FILE}`);
  if (!data) return emptyProfile();
  try {
    const raw = JSON.parse(await data.text()) as Partial<HandwritingProfile>;
    return { samples: Array.isArray(raw.samples) ? raw.samples : [] };
  } catch {
    return emptyProfile();
  }
}

/** Parti da anteporre alle foto da trascrivere: i campioni della grafia con la loro trascrizione. */
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
  if (parts.length) parts.push({ text: "=== FOTO DA TRASCRIVERE ===" });
  return parts;
}

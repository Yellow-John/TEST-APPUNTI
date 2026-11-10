"use client";
import { supabase } from "./supabase/client";
import { type HandwritingCorrection, type HandwritingProfile, PROFILE_FILE, emptyProfile } from "./types";

async function userId() {
  const { data } = await supabase().auth.getUser();
  if (!data.user) throw new Error("Devi effettuare l'accesso");
  return data.user.id;
}

export async function loadProfile(): Promise<HandwritingProfile> {
  const uid = await userId();
  const { data } = await supabase().storage.from("files").download(`${uid}/${PROFILE_FILE}`);
  if (!data) return emptyProfile();
  try {
    return { ...emptyProfile(), ...(JSON.parse(await data.text()) as Partial<HandwritingProfile>) };
  } catch {
    return emptyProfile();
  }
}

export async function saveProfile(p: HandwritingProfile) {
  const uid = await userId();
  const blob = new Blob([JSON.stringify(p)], { type: "application/json" });
  const { error } = await supabase().storage.from("files").upload(`${uid}/${PROFILE_FILE}`, blob, { upsert: true, contentType: "application/json", cacheControl: "0" });
  if (error) throw new Error(`Salvataggio non riuscito: ${error.message}`);
}

export async function addCorrections(pairs: { wrong: string; right: string }[]) {
  const p = await loadProfile();
  const now = new Date().toISOString();
  const key = (c: { wrong: string; right: string }) => `${c.wrong.toLowerCase()}→${c.right.toLowerCase()}`;
  const fresh = pairs.map((c) => ({ ...c, at: now }));
  const merged = [...p.corrections.filter((c) => !fresh.some((f) => key(f) === key(c))), ...fresh];
  await saveProfile({ ...p, corrections: merged.slice(-150) as HandwritingCorrection[] });
}

// ---------- confronto tra testo trascritto e testo corretto ----------

/** Parole del testo, ignorando immagini, segnaposto delle figure e simboli Markdown. */
function words(md: string): string[] {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[FIGURA:\d+\]\]/g, " ")
    .match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu)
    ?.map((w) => w.replace(/[.'’-]+$/, "")) ?? [];
}

/**
 * Coppie «letto male → corretto»: tratti brevi (1-3 parole) sostituiti dall'utente.
 * Ignora le aggiunte/eliminazioni pure e le modifiche lunghe (riscritture, non errori di lettura).
 */
export function diffCorrections(original: string, edited: string): { wrong: string; right: string }[] {
  const a = words(original);
  const b = words(edited);
  if (!a.length || !b.length || a.length * b.length > 25_000_000) return [];
  // LCS sulle parole
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { wrong: string; right: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    const del: string[] = [];
    const ins: string[] = [];
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) break;
      if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) del.push(a[i++]);
      else ins.push(b[j++]);
    }
    if (del.length && ins.length && del.length <= 3 && ins.length <= 3) {
      const wrong = del.join(" ");
      const right = ins.join(" ");
      if (wrong !== right) out.push({ wrong, right });
    }
  }
  // senza duplicati
  return out.filter((c, k) => out.findIndex((x) => x.wrong === c.wrong && x.right === c.right) === k).slice(0, 60);
}

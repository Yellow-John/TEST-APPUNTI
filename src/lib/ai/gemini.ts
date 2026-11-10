import { ApiError, FileState, GoogleGenAI, createPartFromUri, type Content, type Part } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";

// Modelli del piano gratuito di Gemini. Gli alias "-latest" vengono aggiornati da Google a ogni nuova versione.
// Se un nome non esiste più, l'app chiede a Google l'elenco dei modelli disponibili e sceglie il Flash più recente.
export const MODEL_MAIN = process.env.GEMINI_MODEL || "gemini-flash-latest"; // foto, PDF, correzioni, chat
export const MODEL_LITE = process.env.GEMINI_MODEL_LITE || "gemini-flash-lite-latest"; // compiti leggeri + riserva
// Riserva quando il Flash più recente è sovraccarico (succede spesso sul piano gratuito): un Flash stabile più vecchio.
export const MODEL_BACKUP = process.env.GEMINI_MODEL_BACKUP || "gemini-2.5-flash";

export type { Part };
export type Tier = "main" | "backup" | "lite";

let _ai: GoogleGenAI | null = null;
export function gemini() {
  if (!process.env.GEMINI_API_KEY) throw new ConfigError("Manca GEMINI_API_KEY nelle variabili d'ambiente.");
  // v1beta: necessaria per gli alias "-latest", l'output JSON con schema e la Files API (l'SDK usa "v1" di default)
  // timeout per tentativo: anche tre tentativi (principale → riserva → leggero) restano nei 300 s di Vercel
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1beta", timeout: 90_000 } });
  return _ai;
}

export class ConfigError extends Error {}
export class QuotaError extends Error {}
export class RefusalError extends Error {}

export type AiCall = {
  sb: SupabaseClient;
  userId: string;
  feature: string;
  system: string;
  parts: Part[] | string;
  history?: Content[];
  schema?: Record<string, unknown>;
  tier?: Tier;
  maxOutputTokens?: number;
};

function contents(c: AiCall): Content[] {
  const parts = typeof c.parts === "string" ? [{ text: c.parts }] : c.parts;
  return [...(c.history ?? []), { role: "user", parts }];
}

function config(c: AiCall) {
  return {
    systemInstruction: c.system,
    ...(c.maxOutputTokens ? { maxOutputTokens: c.maxOutputTokens } : {}),
    ...(c.schema ? { responseMimeType: "application/json", responseJsonSchema: c.schema } : {}),
  };
}

const isQuota = (e: unknown) => e instanceof ApiError && e.status === 429;
const isModelMissing = (e: unknown) => e instanceof ApiError && e.status === 404;
const isTimeout = (e: unknown) => (e as Error)?.name === "AbortError" || /timed? ?out|timeout|aborted/i.test((e as Error)?.message ?? "");
/** Errori per cui ha senso provare un altro modello: quota finita, sovraccarico, errore del server, troppo lento. */
const isRetriable = (e: unknown) =>
  isQuota(e) || (e instanceof ApiError && [500, 502, 503, 504].includes(e.status)) || isTimeout(e);

// ---------- scelta automatica del modello ----------
const resolved: Partial<Record<Tier, string>> = {};
let available: Promise<string[]> | null = null;

/** Modelli che la chiave può usare con generateContent (elenco gratuito, letto una volta per istanza). */
function listModels(): Promise<string[]> {
  if (!available) {
    available = (async () => {
      const out: string[] = [];
      const pager = await gemini().models.list({ config: { pageSize: 200 } });
      for await (const m of pager) {
        if (m.name && (m.supportedActions ?? []).includes("generateContent")) out.push(m.name.replace(/^models\//, ""));
      }
      return out;
    })().catch((e) => {
      available = null;
      throw e;
    });
  }
  return available;
}

const version = (n: string) => n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? "0";
const byVersionDesc = (a: string, b: string) => parseFloat(version(b)) - parseFloat(version(a));

/** Sceglie il miglior Flash (o Flash-Lite) disponibile, preferendo le versioni stabili e più recenti. */
async function pickFromList(tier: Tier, exclude?: string): Promise<string> {
  const all = (await listModels()).filter((n) => n !== exclude);
  const lite = tier === "lite";
  if (tier === "backup") {
    // un Flash stabile diverso dal più recente (che è quello più spesso sovraccarico)
    const stableFlash = all.filter((n) => /^gemini-\d+(\.\d+)?-flash$/.test(n) && n !== modelFor("main")).sort(byVersionDesc);
    const pick = stableFlash[1] ?? stableFlash[0];
    if (!pick) return pickFromList("lite", exclude);
    return pick;
  }
  const ok = (n: string) => /^gemini-/.test(n) && n.includes("flash") && n.includes("lite") === lite && !/image|tts|audio|live|embedding|thinking/.test(n);
  const cands = all.filter(ok);
  const stable = cands.filter((n) => !/preview|exp/.test(n)).sort(byVersionDesc);
  const best = (lite ? ["gemini-flash-lite-latest"] : ["gemini-flash-latest"]).find((a) => all.includes(a)) ?? stable[0] ?? cands.sort(byVersionDesc)[0];
  if (!best) {
    if (lite) return pickFromList("main", exclude);
    throw new ConfigError("Nessun modello Gemini Flash disponibile per questa chiave API.");
  }
  return best;
}

function modelFor(tier: Tier) {
  return resolved[tier] ?? (tier === "lite" ? MODEL_LITE : tier === "backup" ? MODEL_BACKUP : MODEL_MAIN);
}

/** Esegue fn sul modello del livello indicato; se il nome non esiste più, sceglie un modello disponibile e riprova. */
async function onTier<T>(tier: Tier, fn: (model: string) => Promise<T>): Promise<T> {
  try {
    return await fn(modelFor(tier));
  } catch (e) {
    if (!isModelMissing(e) || resolved[tier]) throw e;
    resolved[tier] = await pickFromList(tier, modelFor(tier));
    console.warn(`Modello Gemini non trovato, uso ${resolved[tier]} (${tier})`);
    return fn(resolved[tier]!);
  }
}

/**
 * Esegue fn provando i modelli in ordine: principale → riserva → leggero (per i compiti leggeri: leggero → riserva).
 * Passa al successivo se la quota è finita, se Google è sovraccarico o se la risposta tarda troppo.
 */
async function withFallback<T>(c: AiCall, fn: (model: string) => Promise<T>): Promise<T> {
  const chain: Tier[] = c.tier === "lite" ? ["lite", "backup"] : ["main", "backup", "lite"];
  const tried = new Set<string>();
  let last: unknown;
  let quota = false;
  for (const tier of chain) {
    if (tried.has(modelFor(tier))) continue;
    tried.add(modelFor(tier));
    try {
      return await onTier(tier, fn);
    } catch (e) {
      last = e;
      if (isQuota(e)) quota = true;
      // anche un modello inesistente (dopo la scelta automatica) non deve bloccare la catena
      if (!isRetriable(e) && !isModelMissing(e)) throw e;
      console.warn(`Gemini ${modelFor(tier)} non disponibile (${(e as Error).message?.slice(0, 120)}), provo il successivo`);
    }
  }
  if (quota && isQuota(last)) throw quotaError();
  throw last;
}

function quotaError() {
  return new QuotaError(
    "Hai esaurito la quota gratuita di Gemini per oggi (o per questo minuto). Riprova più tardi: la quota si rinnova ogni giorno.",
  );
}

export async function logUsage(sb: SupabaseClient, userId: string, feature: string, model: string, input: number, output: number) {
  await sb.from("ai_usage").insert({ user_id: userId, feature, model, input_tokens: input, output_tokens: output, cost_usd: 0 });
}

/** Chiamata completa che restituisce il testo finale. */
export async function callAI(c: AiCall): Promise<string> {
  return withFallback(c, async (model) => {
    const res = await gemini().models.generateContent({ model, contents: contents(c), config: config(c) });
    const u = res.usageMetadata;
    await logUsage(c.sb, c.userId, c.feature, model, u?.promptTokenCount ?? 0, (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0));
    const reason = res.candidates?.[0]?.finishReason;
    if (res.promptFeedback?.blockReason || reason === "SAFETY" || reason === "PROHIBITED_CONTENT") {
      throw new RefusalError("Il contenuto è stato bloccato dai filtri di sicurezza di Gemini.");
    }
    if (reason === "MAX_TOKENS") throw new Error("Risposta troppo lunga: prova a dividere il documento in parti più piccole.");
    const text = res.text;
    if (!text) throw new Error("Risposta vuota dall'AI, riprova.");
    return text;
  });
}

/** Chiamata con output JSON strutturato. */
export async function callAIJSON<T>(c: AiCall & { schema: Record<string, unknown> }): Promise<T> {
  const text = await callAI(c);
  try {
    return JSON.parse(text) as T;
  } catch {
    // a volte il JSON arriva dentro un blocco ```json
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error("Risposta dell'AI non valida, riprova.");
  }
}

/** Streaming del testo verso il browser (chat). */
export async function streamAI(c: AiCall): Promise<ReadableStream<Uint8Array>> {
  const enc = new TextEncoder();
  const { stream, model } = await withFallback(c, async (model) => ({
    model,
    stream: await gemini().models.generateContentStream({ model, contents: contents(c), config: config(c) }),
  }));
  return new ReadableStream({
    async start(controller) {
      let input = 0;
      let output = 0;
      try {
        for await (const chunk of stream) {
          if (chunk.text) controller.enqueue(enc.encode(chunk.text));
          if (chunk.usageMetadata) {
            input = chunk.usageMetadata.promptTokenCount ?? input;
            output = (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0);
          }
          const reason = chunk.candidates?.[0]?.finishReason;
          if (reason === "SAFETY" || reason === "PROHIBITED_CONTENT") {
            controller.enqueue(enc.encode("\n\n_Risposta bloccata dai filtri di sicurezza._"));
          }
        }
        await logUsage(c.sb, c.userId, c.feature, model, input, output);
      } catch (e) {
        controller.enqueue(enc.encode(`\n\n_Errore: ${isQuota(e) ? quotaError().message : (e as Error).message}_`));
      } finally {
        controller.close();
      }
    },
  });
}

/** Messaggio leggibile (e codice) per un errore delle funzioni AI. */
export function aiErrorInfo(e: unknown): { message: string; status: number; code?: string } {
  if (e instanceof QuotaError) return { message: e.message, status: 429, code: "quota" };
  if (e instanceof RefusalError) return { message: e.message, status: 422 };
  if (e instanceof ConfigError) return { message: e.message, status: 500 };
  if (e instanceof ApiError) {
    if (e.status === 400 && /API key/i.test(e.message)) return { message: "Chiave API di Gemini non valida.", status: 500 };
    if (e.status === 401 || e.status === 403) return { message: "Chiave API di Gemini non valida o non autorizzata.", status: 500 };
    if (e.status === 503) return { message: "Gemini è sovraccarico in questo momento, riprova tra poco.", status: 503 };
    return { message: `Errore AI (${e.status}): ${e.message}`, status: 502 };
  }
  const msg = (e as Error)?.message || "Errore sconosciuto";
  if ((e as Error)?.name === "AbortError" || /timed? ?out|timeout|aborted/i.test(msg)) {
    return { message: "L'AI ha impiegato troppo tempo a rispondere. Riprova (con meno pagine o un file più piccolo).", status: 504 };
  }
  console.error(e);
  return { message: msg, status: 500 };
}

/** Converte gli errori in una risposta JSON leggibile. */
export function aiErrorResponse(e: unknown) {
  const { message, status, code } = aiErrorInfo(e);
  return Response.json({ error: message, ...(code ? { code } : {}) }, { status });
}

/** Scarica un file dallo storage dell'utente. */
export async function storageFile(sb: SupabaseClient, userId: string, path: string) {
  if (!path.startsWith(`${userId}/`)) throw new Error("Percorso file non valido");
  const { data, error } = await sb.storage.from("files").download(path);
  if (error || !data) throw new Error(`Impossibile leggere il file: ${error?.message}`);
  return data;
}

export async function blobToInlinePart(blob: Blob, fallbackMime: string): Promise<Part> {
  const buf = Buffer.from(await blob.arrayBuffer());
  return { inlineData: { mimeType: blob.type || fallbackMime, data: buf.toString("base64") } };
}

/** PDF grandi: caricati con la Files API di Gemini (gratuita, file eliminati dopo l'uso). */
export async function uploadLargeFile(blob: Blob, mimeType: string): Promise<{ part: Part; cleanup: () => Promise<void> }> {
  const ai = gemini();
  let file = await ai.files.upload({ file: blob, config: { mimeType } });
  for (let i = 0; i < 60 && file.state === FileState.PROCESSING; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    file = await ai.files.get({ name: file.name! });
  }
  if (file.state === FileState.FAILED || !file.uri) throw new Error("Gemini non è riuscito a leggere il file.");
  return {
    part: createPartFromUri(file.uri, file.mimeType || mimeType),
    cleanup: async () => {
      await ai.files.delete({ name: file.name! }).catch(() => {});
    },
  };
}

/** Diagnostica: elenco dei modelli disponibili per la chiave. */
export async function diagListModels() {
  return listModels();
}

/** Diagnostica: risposta minima da un modello, con il nome del modello effettivamente usato. */
export async function diagPing(tier: Tier) {
  // nessuna catena di riserva qui: si vuole sapere lo stato di ogni singolo modello
  return onTier(tier, async (model) => {
    const res = await gemini().models.generateContent({ model, contents: "Rispondi solo con la parola OK." });
    return { model, text: (res.text ?? "").trim().slice(0, 40), finishReason: res.candidates?.[0]?.finishReason };
  });
}

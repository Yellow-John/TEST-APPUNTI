import { ApiError, FileState, GoogleGenAI, createPartFromUri, type Content, type GenerateContentResponse, type Part } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Candidate, CompatError, UnsupportedInput, compatChain, compatChat, compatStream, hasUnsupported, pauseAfter } from "./compat";

// Piano gratuito di Gemini: la quota giornaliera è PER MODELLO (es. 20 richieste/giorno sul Flash più recente).
// Per questo l'app non usa un solo modello ma una catena: tutti i Flash stabili disponibili per la chiave,
// dal più recente al più vecchio, poi i Flash-Lite. Un modello esaurito o sovraccarico viene saltato
// finché Google non lo rende di nuovo disponibile. GEMINI_MODEL / GEMINI_MODEL_LITE, se impostati, vanno in testa.
export const MODEL_MAIN = process.env.GEMINI_MODEL || "";
export const MODEL_LITE = process.env.GEMINI_MODEL_LITE || "";
// usati solo se l'elenco dei modelli non si può leggere
const STATIC_MAIN = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"];
const STATIC_LITE = ["gemini-flash-lite-latest", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-2.5-flash"];

export type { Part };
export type Tier = "main" | "lite";

let _ai: GoogleGenAI | null = null;
export function gemini() {
  if (!process.env.GEMINI_API_KEY) throw new ConfigError("Manca GEMINI_API_KEY nelle variabili d'ambiente.");
  // v1beta: necessaria per gli alias "-latest", l'output JSON con schema e la Files API (l'SDK usa "v1" di default)
  // timeout per tentativo; in più la catena si ferma prima dei 300 s di Vercel (vedi DEADLINE_MS)
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
  /** chiamata con il modello che ha prodotto la risposta accettata (l'ultima chiamata vince) */
  onModel?: (model: string, provider: string) => void;
};

/** Modello "buono": un Flash di Gemini non Lite. Tutto il resto è una riserva, meno precisa sulla scrittura a mano. */
export function isPrimaryModel(provider: string, model: string) {
  return provider === "gemini" && !/lite/i.test(model);
}

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

// ---------- catena dei modelli ----------
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

const version = (n: string) => parseFloat(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? "0");
const byVersionDesc = (a: string, b: string) => version(b) - version(a);

/** Ordine dei modelli da provare per un livello. */
export async function modelChain(tier: Tier): Promise<string[]> {
  let flash: string[];
  let lite: string[];
  try {
    const all = await listModels();
    // solo modelli stabili "gemini-X.Y-flash" e "gemini-X.Y-flash-lite" (niente preview, immagini, audio, alias duplicati)
    flash = all.filter((n) => /^gemini-\d+(\.\d+)?-flash$/.test(n)).sort(byVersionDesc);
    lite = all.filter((n) => /^gemini-\d+(\.\d+)?-flash-lite$/.test(n)).sort(byVersionDesc);
    if (!flash.length && !lite.length) throw new Error("nessun Flash nell'elenco");
  } catch {
    flash = [];
    lite = [];
    const fallback = tier === "lite" ? STATIC_LITE : STATIC_MAIN;
    return [...new Set([tier === "lite" ? MODEL_LITE : MODEL_MAIN, ...fallback].filter(Boolean))];
  }
  const order = tier === "lite" ? [MODEL_LITE, ...lite, ...flash] : [MODEL_MAIN, ...flash, ...lite];
  return [...new Set(order.filter(Boolean))];
}

/** Modelli temporaneamente da saltare (quota esaurita, sovraccarico, inesistente), con l'ora in cui riprovarli. */
const cooldown = new Map<string, number>();

function cooldownFor(e: unknown): number {
  if (isQuota(e)) {
    const msg = (e as Error).message;
    // Google indica quando riprovare: "retryDelay":"65222s" oppure "Please retry in 18h7m2.5s"
    const delay = msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
    if (delay) return Number(delay[1]) * 1000;
    const human = msg.match(/retry in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i);
    if (human && (human[1] || human[2] || human[3])) {
      return ((Number(human[1] ?? 0) * 60 + Number(human[2] ?? 0)) * 60 + Number(human[3] ?? 0)) * 1000;
    }
    return 10 * 60_000;
  }
  if (isModelMissing(e)) return 24 * 3600_000;
  if (isTimeout(e)) return 5 * 60_000;
  return 2 * 60_000; // sovraccarico / errore del server
}

const DEADLINE_MS = 120_000; // poi si passa agli altri provider; Vercel interrompe a 300 s

/** Esegue fn sul primo modello disponibile della catena, passando al successivo se esaurito/sovraccarico/lento. */
async function withFallback<T>(c: AiCall, fn: (model: string) => Promise<T>): Promise<T> {
  const chain = await modelChain(c.tier ?? "main");
  const start = Date.now();
  let last: unknown = null;
  let quota = false;
  const now = Date.now();
  // prima i modelli non in pausa; se sono tutti in pausa, si riprova comunque il primo
  const ready = chain.filter((m) => (cooldown.get(m) ?? 0) <= now);
  for (const model of ready.length ? ready : chain.slice(0, 1)) {
    if (Date.now() - start > DEADLINE_MS) break;
    try {
      return await fn(model);
    } catch (e) {
      last = e;
      if (!isRetriable(e) && !isModelMissing(e)) throw e;
      if (isQuota(e)) quota = true;
      cooldown.set(model, Date.now() + cooldownFor(e));
      console.warn(`Gemini ${model} non disponibile (${(e as Error).message?.slice(0, 120)}), provo il successivo`);
    }
  }
  if (!last && !ready.length) throw quotaError();
  if (quota && (isQuota(last) || isModelMissing(last))) throw quotaError();
  throw last ?? quotaError();
}

function quotaError() {
  return new QuotaError(
    "Tutti i modelli gratuiti di Gemini hanno esaurito la quota o sono occupati. Riprova più tardi: le quote si rinnovano ogni giorno.",
  );
}

export async function logUsage(sb: SupabaseClient, userId: string, feature: string, model: string, input: number, output: number) {
  await sb.from("ai_usage").insert({ user_id: userId, feature, model, input_tokens: input, output_tokens: output, cost_usd: 0 });
}

const TOTAL_DEADLINE_MS = 220_000;
const freeFirst = () => (process.env.FREELLMAPI_MODE ?? "fallback") === "first";

/** Interpreta un JSON anche se arriva dentro un blocco ```json o con testo intorno. */
export function parseJsonLoose<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        /* sotto */
      }
    }
    throw new Error("Risposta dell'AI non in formato JSON valido.");
  }
}

/**
 * Prova in ordine: Gemini (tutti i suoi modelli gratuiti), poi gli altri provider gratuiti configurati
 * (Mistral, Groq, OpenRouter, Cerebras, FreeLLMAPI). Con FREELLMAPI_MODE=first, FreeLLMAPI va per primo.
 * `accept` può rifiutare una risposta (es. JSON non valido) per passare al modello successivo.
 */
async function viaProviders<T>(
  c: AiCall,
  gem: () => Promise<T>,
  other: (cand: Candidate) => Promise<T>,
  accept?: (r: T) => void,
): Promise<T> {
  const start = Date.now();
  const cands = hasUnsupported(c) ? [] : await compatChain(c).catch(() => [] as Candidate[]);
  const free = cands.filter((x) => x.provider.id === "freellmapi");
  const rest = cands.filter((x) => x.provider.id !== "freellmapi");
  type Step = { run: () => Promise<T>; cand?: Candidate };
  const g: Step = { run: gem };
  const steps: Step[] = freeFirst()
    ? [...free.map((cand) => ({ run: () => other(cand), cand })), g, ...rest.map((cand) => ({ run: () => other(cand), cand }))]
    : [g, ...cands.map((cand) => ({ run: () => other(cand), cand }))];
  const errors: unknown[] = [];
  for (const step of steps) {
    if (errors.length && Date.now() - start > TOTAL_DEADLINE_MS) break;
    try {
      const r = await step.run();
      accept?.(r);
      return r;
    } catch (e) {
      errors.push(e);
      if (step.cand) pauseAfter(step.cand, e);
      console.warn(`AI non disponibile (${step.cand ? `${step.cand.provider.id}:${step.cand.model}` : "gemini"}): ${(e as Error).message?.slice(0, 160)}`);
    }
  }
  const useful = errors.filter((e) => !(e instanceof UnsupportedInput));
  if (steps.length > 1 && useful.every((e) => e instanceof QuotaError || (e instanceof CompatError && [429, 500, 502, 503].includes(e.status)))) {
    throw new QuotaError(
      "Tutti i modelli AI gratuiti configurati hanno esaurito la quota o sono occupati. Riprova più tardi: le quote si rinnovano ogni giorno.",
    );
  }
  throw useful.find((e) => e instanceof QuotaError) ?? useful[0] ?? errors[0];
}

async function callText(c: AiCall, accept?: (text: string) => void): Promise<string> {
  return viaProviders(
    c,
    () => callGemini(c),
    async (cand) => {
      const r = await compatChat(cand, c);
      accept?.(r.text); // prima di registrare: una risposta scartata non conta
      await logUsage(c.sb, c.userId, c.feature, r.model, r.input, r.output);
      c.onModel?.(r.model, cand.provider.id);
      return r.text;
    },
    accept,
  );
}

/** Chiamata completa che restituisce il testo finale. */
export async function callAI(c: AiCall): Promise<string> {
  return callText(c);
}

async function callGemini(c: AiCall): Promise<string> {
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
    c.onModel?.(model, "gemini");
    return text;
  });
}

/** Chiamata con output JSON strutturato: se un modello risponde con JSON non valido si prova il successivo. */
export async function callAIJSON<T>(c: AiCall & { schema: Record<string, unknown> }): Promise<T> {
  let parsed: T | undefined;
  await callText(c, (text) => {
    parsed = parseJsonLoose<T>(text);
    if (!parsed || typeof parsed !== "object") throw new Error("Risposta dell'AI non valida.");
  });
  return parsed as T;
}

/** Streaming del testo verso il browser (chat). */
export async function streamAI(c: AiCall): Promise<ReadableStream<Uint8Array>> {
  const enc = new TextEncoder();
  const opened = await viaProviders<{ model: string; stream?: AsyncGenerator<GenerateContentResponse>; chunks?: AsyncGenerator<string> }>(
    c,
    () => withFallback(c, async (model) => ({ model, stream: await gemini().models.generateContentStream({ model, contents: contents(c), config: config(c) }) })),
    (cand) => compatStream(cand, c),
  );
  if (opened.chunks) {
    const { chunks, model } = opened;
    return new ReadableStream({
      async start(controller) {
        try {
          for await (const t of chunks) controller.enqueue(enc.encode(t));
          await logUsage(c.sb, c.userId, c.feature, model, 0, 0);
        } catch (e) {
          controller.enqueue(enc.encode(`\n\n_Errore: ${(e as Error).message}_`));
        } finally {
          controller.close();
        }
      },
    });
  }
  const { model } = opened;
  const stream = opened.stream!;
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
  if (e instanceof CompatError) {
    if (e.status === 401 || e.status === 403) return { message: `Chiave API non valida per ${e.provider}: controlla la variabile su Vercel.`, status: 500 };
    if (e.status === 429) return { message: "Anche gli altri provider gratuiti hanno esaurito la quota: riprova più tardi.", status: 429, code: "quota" };
    return { message: e.message, status: 502 };
  }
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

/** Diagnostica: catena dei modelli e stato di pausa di ciascuno. */
export async function diagChain() {
  const now = Date.now();
  const status = (m: string) => {
    const until = cooldown.get(m) ?? 0;
    return until > now ? `${m} (in pausa ancora ${Math.round((until - now) / 60_000)} min)` : m;
  };
  return { principale: (await modelChain("main")).map(status), leggero: (await modelChain("lite")).map(status) };
}

/** Diagnostica: una sola richiesta minima attraverso la catena, per sapere quale modello risponde davvero. */
export async function diagTry(tier: Tier) {
  return withFallback({ tier } as AiCall, async (model) => {
    const res = await gemini().models.generateContent({ model, contents: "Rispondi solo con la parola OK." });
    return { modello_che_ha_risposto: model, testo: (res.text ?? "").trim().slice(0, 40) };
  });
}

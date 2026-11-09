import { ApiError, FileState, GoogleGenAI, createPartFromUri, type Content, type Part } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";

// Modelli del piano gratuito di Gemini. Gli alias "-latest" vengono aggiornati da Google a ogni nuova versione.
export const MODEL_MAIN = process.env.GEMINI_MODEL || "gemini-flash-latest"; // foto, PDF, correzioni, chat
export const MODEL_LITE = process.env.GEMINI_MODEL_LITE || "gemini-flash-lite-latest"; // compiti leggeri + riserva

export type { Part };
export type Tier = "main" | "lite";

let _ai: GoogleGenAI | null = null;
export function gemini() {
  if (!process.env.GEMINI_API_KEY) throw new ConfigError("Manca GEMINI_API_KEY nelle variabili d'ambiente.");
  if (!_ai) _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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

/** Esegue fn sul modello principale; se la quota gratuita è finita, riprova sul modello "lite". */
async function withFallback<T>(c: AiCall, fn: (model: string) => Promise<T>): Promise<T> {
  const first = c.tier === "lite" ? MODEL_LITE : MODEL_MAIN;
  try {
    return await fn(first);
  } catch (e) {
    if (isQuota(e) && first !== MODEL_LITE) {
      try {
        return await fn(MODEL_LITE);
      } catch (e2) {
        if (isQuota(e2)) throw quotaError();
        throw e2;
      }
    }
    if (isQuota(e)) throw quotaError();
    throw e;
  }
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

/** Converte gli errori in una risposta JSON leggibile. */
export function aiErrorResponse(e: unknown) {
  if (e instanceof QuotaError) return Response.json({ error: e.message, code: "quota" }, { status: 429 });
  if (e instanceof RefusalError) return Response.json({ error: e.message }, { status: 422 });
  if (e instanceof ConfigError) return Response.json({ error: e.message }, { status: 500 });
  if (e instanceof ApiError) {
    if (e.status === 400 && /API key/i.test(e.message)) return Response.json({ error: "Chiave API di Gemini non valida." }, { status: 500 });
    if (e.status === 401 || e.status === 403) return Response.json({ error: "Chiave API di Gemini non valida o non autorizzata." }, { status: 500 });
    if (e.status === 503) return Response.json({ error: "Gemini è sovraccarico in questo momento, riprova tra poco." }, { status: 503 });
    return Response.json({ error: `Errore AI (${e.status}): ${e.message}` }, { status: 502 });
  }
  console.error(e);
  return Response.json({ error: (e as Error).message || "Errore sconosciuto" }, { status: 500 });
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

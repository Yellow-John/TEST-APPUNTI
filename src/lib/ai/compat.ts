import type { Content, Part } from "@google/genai";
import type { AiCall } from "./gemini";

// Provider con API compatibile OpenAI e piano gratuito, chiamati direttamente dal server dell'app.
// (<PROVIDER>_BASE_URL permette di cambiare indirizzo, es. per i test o se un provider cambia dominio.)
// Ognuno è attivo solo se la sua chiave è impostata. I modelli NON sono scritti a mano: si legge l'elenco
// aggiornato di ogni provider e si scelgono quelli adatti (per le foto, solo quelli che leggono immagini).

export class CompatError extends Error {
  constructor(message: string, public status: number, public provider: string) {
    super(message);
  }
}
/** Contenuto che questi provider non possono ricevere (es. PDF): resta su Gemini. */
export class UnsupportedInput extends Error {}

type ModelInfo = { id: string; vision: boolean; rank: number };
type Provider = {
  id: string;
  name: string;
  base: () => string;
  key: () => string;
  /** elenco dei modelli gratuiti utilizzabili per chat */
  models: () => Promise<ModelInfo[]>;
  headers?: () => Record<string, string>;
};

const env = (k: string) => (process.env[k] ?? "").trim();
const TIMEOUT_MS = 60_000;

/** "Grandezza" stimata del modello dal nome (es. 70b, 235b; large > medium > small), per provare prima i migliori. */
function rankOf(id: string): number {
  const sizes = [...id.matchAll(/(\d+(?:\.\d+)?)b(?![a-z])/gi)].map((m) => parseFloat(m[1]));
  if (sizes.length) return Math.max(...sizes);
  if (/large/i.test(id)) return 120;
  if (/medium/i.test(id)) return 60;
  if (/maverick/i.test(id)) return 400;
  if (/scout/i.test(id)) return 100;
  if (/small/i.test(id)) return 24;
  if (/ministral|tiny|mini|nano/i.test(id)) return 8;
  return 20;
}

const NOT_CHAT = /whisper|tts|speech|audio|transcri|guard|embed|moderation|rerank|ocr|image-gen|playai|orpheus|compound|safety/i;

async function getJson(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new CompatError(`elenco modelli (${r.status})`, r.status, url);
  return r.json();
}

const bearer = (k: string) => ({ Authorization: `Bearer ${k}` });

export const PROVIDERS: Provider[] = [
  {
    id: "mistral",
    name: "Mistral",
    base: () => env("MISTRAL_BASE_URL") || "https://api.mistral.ai/v1",
    key: () => env("MISTRAL_API_KEY"),
    models: async () => {
      const j = await getJson(`${env("MISTRAL_BASE_URL") || "https://api.mistral.ai/v1"}/models`, bearer(env("MISTRAL_API_KEY")));
      type M = { id: string; capabilities?: { completion_chat?: boolean; vision?: boolean }; deprecation?: string | null };
      return (j.data as M[])
        .filter((m) => m.capabilities?.completion_chat && !m.deprecation && /-latest$/.test(m.id) && !NOT_CHAT.test(m.id) && !/codestral|devstral|magistral/i.test(m.id))
        .map((m) => ({ id: m.id, vision: !!m.capabilities?.vision, rank: rankOf(m.id) }));
    },
  },
  {
    id: "groq",
    name: "Groq",
    base: () => env("GROQ_BASE_URL") || "https://api.groq.com/openai/v1",
    key: () => env("GROQ_API_KEY"),
    models: async () => {
      const j = await getJson(`${env("GROQ_BASE_URL") || "https://api.groq.com/openai/v1"}/models`, bearer(env("GROQ_API_KEY")));
      type M = { id: string; active?: boolean };
      return (j.data as M[])
        .filter((m) => m.active !== false && !NOT_CHAT.test(m.id))
        .map((m) => ({ id: m.id, vision: /llama-4|vision|[-/]vl\b|-vl-|scout|maverick/i.test(m.id), rank: rankOf(m.id) }));
    },
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    base: () => env("OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1",
    key: () => env("OPENROUTER_API_KEY"),
    headers: () => ({ "X-Title": "Appunti" }),
    models: async () => {
      // elenco pubblico; solo i modelli completamente gratuiti (":free" o prezzo zero)
      const j = await getJson(`${env("OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1"}/models`, {});
      type M = { id: string; pricing?: { prompt?: string; completion?: string }; architecture?: { input_modalities?: string[]; output_modalities?: string[] } };
      return (j.data as M[])
        .filter((m) => (m.id.endsWith(":free") || (m.pricing?.prompt === "0" && m.pricing?.completion === "0")) && !m.id.startsWith("openrouter/"))
        .filter((m) => (m.architecture?.output_modalities ?? ["text"]).includes("text") && !NOT_CHAT.test(m.id))
        .map((m) => ({ id: m.id, vision: (m.architecture?.input_modalities ?? []).includes("image"), rank: rankOf(m.id) }));
    },
  },
  {
    id: "cerebras",
    name: "Cerebras",
    base: () => env("CEREBRAS_BASE_URL") || "https://api.cerebras.ai/v1",
    key: () => env("CEREBRAS_API_KEY"),
    models: async () => {
      const j = await getJson(`${env("CEREBRAS_BASE_URL") || "https://api.cerebras.ai/v1"}/models`, bearer(env("CEREBRAS_API_KEY")));
      return (j.data as { id: string }[]).filter((m) => !NOT_CHAT.test(m.id)).map((m) => ({ id: m.id, vision: false, rank: rankOf(m.id) }));
    },
  },
  {
    // FreeLLMAPI (facoltativo): proxy self-hosted che fa da router tra molti provider
    id: "freellmapi",
    name: "FreeLLMAPI",
    base: () => env("FREELLMAPI_URL").replace(/\/+$/, ""),
    key: () => (env("FREELLMAPI_URL") ? env("FREELLMAPI_KEY") : ""),
    models: async () => [{ id: env("FREELLMAPI_MODEL") || "auto", vision: true, rank: 1000 }],
  },
];

export const enabledProviders = () => PROVIDERS.filter((p) => p.key());

// ---------- elenco modelli (in cache per 6 ore) e pause ----------
const modelCache = new Map<string, { at: number; list: ModelInfo[] }>();
async function modelsOf(p: Provider): Promise<ModelInfo[]> {
  const hit = modelCache.get(p.id);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.list;
  const list = (await p.models()).sort((a, b) => b.rank - a.rank);
  modelCache.set(p.id, { at: Date.now(), list });
  return list;
}

const cooldown = new Map<string, number>(); // "provider" o "provider:modello" → riprova dopo
const paused = (k: string) => (cooldown.get(k) ?? 0) > Date.now();

export type Candidate = { provider: Provider; model: string };

/** Modelli da provare, in ordine. Per le foto solo modelli che leggono immagini; per i compiti leggeri i più piccoli prima. */
export async function compatChain(c: AiCall, perProvider = 2): Promise<Candidate[]> {
  const vision = needsVision(c);
  const out: Candidate[] = [];
  for (const p of enabledProviders()) {
    if (paused(p.id)) continue;
    let list: ModelInfo[];
    try {
      list = await modelsOf(p);
    } catch (e) {
      cooldown.set(p.id, Date.now() + ((e as CompatError).status === 401 || (e as CompatError).status === 403 ? 3600_000 : 5 * 60_000));
      continue;
    }
    let usable = list.filter((m) => (!vision || m.vision) && !paused(`${p.id}:${m.id}`));
    if (c.tier === "lite") usable = [...usable].sort((a, b) => a.rank - b.rank).filter((m) => m.rank >= 7);
    out.push(...usable.slice(0, perProvider).map((m) => ({ provider: p, model: m.id })));
  }
  return out;
}

/** Mette in pausa un modello (o l'intero provider se la chiave non è valida). */
export function pauseAfter(cand: Candidate, e: unknown) {
  const s = (e as CompatError).status ?? 0;
  if (s === 401 || s === 403) cooldown.set(cand.provider.id, Date.now() + 3600_000);
  else if (s === 429) cooldown.set(`${cand.provider.id}:${cand.model}`, Date.now() + 10 * 60_000);
  else if (s === 404 || s === 400 || s === 422) cooldown.set(`${cand.provider.id}:${cand.model}`, Date.now() + 6 * 3600_000);
  else cooldown.set(`${cand.provider.id}:${cand.model}`, Date.now() + 2 * 60_000);
}

// ---------- conversione dei messaggi ----------
type OAContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
type OAMessage = { role: "system" | "user" | "assistant"; content: OAContent };

function partsOf(c: AiCall): Part[] {
  return typeof c.parts === "string" ? [{ text: c.parts }] : c.parts;
}
function needsVision(c: AiCall) {
  return partsOf(c).some((p) => p.inlineData?.mimeType?.startsWith("image/"));
}
export function hasUnsupported(c: AiCall) {
  return partsOf(c).some((p) => (p.inlineData && !p.inlineData.mimeType?.startsWith("image/")) || p.fileData);
}

function convertParts(parts: Part[]): OAContent {
  const out: Exclude<OAContent, string> = [];
  for (const p of parts) {
    if (p.text) out.push({ type: "text", text: p.text });
    else if (p.inlineData?.mimeType?.startsWith("image/")) {
      out.push({ type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
    } else throw new UnsupportedInput("Questo tipo di file (es. PDF) può essere letto solo da Gemini.");
  }
  return out.every((x) => x.type === "text") ? out.map((x) => (x as { text: string }).text).join("\n") : out;
}

function messages(c: AiCall): OAMessage[] {
  // l'output JSON viene richiesto nel prompt: non tutti i modelli gratuiti supportano response_format con schema
  const system = c.schema
    ? `${c.system}\n\nRispondi ESCLUSIVAMENTE con un oggetto JSON valido (senza testo prima o dopo, senza blocchi \`\`\`) conforme a questo JSON Schema:\n${JSON.stringify(c.schema)}`
    : c.system;
  const history = (c.history ?? []).map((h: Content) => ({
    role: (h.role === "model" ? "assistant" : "user") as OAMessage["role"],
    content: convertParts(h.parts ?? []),
  }));
  return [{ role: "system", content: system }, ...history, { role: "user", content: convertParts(partsOf(c)) }];
}

async function post(cand: Candidate, c: AiCall, stream: boolean) {
  const { provider: p, model } = cand;
  const res = await fetch(`${p.base()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(p.key()), ...(p.headers?.() ?? {}) },
    body: JSON.stringify({ model, messages: messages(c), stream, max_tokens: Math.min(c.maxOutputTokens ?? 8192, 8192) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = body.slice(0, 300);
    try {
      const j = JSON.parse(body);
      msg = j.error?.message ?? j.message ?? j.detail ?? msg;
    } catch {
      /* testo semplice */
    }
    throw new CompatError(`${p.name} ${model} (${res.status}): ${typeof msg === "string" ? msg : JSON.stringify(msg)}`, res.status, p.id);
  }
  const routed = res.headers.get("x-routed-via");
  return { res, label: `${p.id}:${routed || model}` };
}

/** Risposta completa da un modello. */
export async function compatChat(cand: Candidate, c: AiCall) {
  const { res, label } = await post(cand, c, false);
  const j = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = j.choices?.[0]?.message?.content ?? "";
  if (!text) throw new CompatError(`${cand.provider.name}: risposta vuota`, 502, cand.provider.id);
  if (j.choices?.[0]?.finish_reason === "length") throw new CompatError(`${cand.provider.name}: risposta troncata`, 502, cand.provider.id);
  return { text, model: label, input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 };
}

/** Streaming SSE in formato OpenAI. */
export async function compatStream(cand: Candidate, c: AiCall) {
  const { res, label } = await post(cand, c, true);
  async function* chunks() {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const t = JSON.parse(data).choices?.[0]?.delta?.content;
          if (t) yield t as string;
        } catch {
          /* riga di servizio */
        }
      }
    }
  }
  return { chunks: chunks(), model: label };
}

/** Diagnostica: per ogni provider, modelli gratuiti trovati e una risposta minima dal primo. */
export async function compatDiag() {
  const out: Record<string, unknown> = {};
  for (const p of PROVIDERS) {
    if (!p.key()) {
      out[p.name] = "non configurato";
      continue;
    }
    try {
      const list = await modelsOf(p);
      const first = list[0];
      if (!first) {
        out[p.name] = { modelli: 0 };
        continue;
      }
      const r = await compatChat({ provider: p, model: first.id }, { system: "Sei un assistente.", parts: "Rispondi solo con la parola OK." } as AiCall);
      out[p.name] = {
        modelli: list.length,
        con_immagini: list.filter((m) => m.vision).map((m) => m.id).slice(0, 5),
        prova: `${r.model} → ${r.text.trim().slice(0, 20)}`,
      };
    } catch (e) {
      out[p.name] = { errore: (e as Error).message.slice(0, 200) };
    }
  }
  return out;
}

/** Azzera cache e pause (usato dai test). */
export function resetCompatState() {
  modelCache.clear();
  cooldown.clear();
}

import type { Content, Part } from "@google/genai";
import type { AiCall } from "./gemini";

// FreeLLMAPI (github.com/tashfeenahmed/freellmapi): proxy self-hosted che riunisce i piani gratuiti di molti
// provider (Groq, Cerebras, OpenRouter, Mistral, ...) dietro un endpoint compatibile OpenAI.
// Attivo solo se sono impostate FREELLMAPI_URL (es. https://mio-server/v1) e FREELLMAPI_KEY (freellmapi-...).
// variabili lette al momento dell'uso
const url = () => (process.env.FREELLMAPI_URL ?? "").trim().replace(/\/+$/, "");
const key = () => (process.env.FREELLMAPI_KEY ?? "").trim();
const model = () => process.env.FREELLMAPI_MODEL || "auto"; // "auto" = il router sceglie il miglior modello gratuito disponibile
/** "fallback" (predefinito): usato quando i modelli Gemini non sono disponibili. "first": provato prima di Gemini. */
export const freeFirst = () => (process.env.FREELLMAPI_MODE ?? "fallback") === "first";

export const freeEnabled = () => !!(url() && key());

export class FreeLLMError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
/** Contenuto che FreeLLMAPI non può ricevere (es. PDF): si resta su Gemini. */
export class UnsupportedInput extends Error {}

type OAContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
type OAMessage = { role: "system" | "user" | "assistant"; content: OAContent };

function convertParts(parts: Part[]): OAContent {
  const out: Exclude<OAContent, string> = [];
  for (const p of parts) {
    if (p.text) out.push({ type: "text", text: p.text });
    else if (p.inlineData?.mimeType?.startsWith("image/")) {
      out.push({ type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
    } else throw new UnsupportedInput("FreeLLMAPI non accetta questo tipo di file (es. PDF).");
  }
  return out.every((x) => x.type === "text") ? out.map((x) => (x as { text: string }).text).join("\n") : out;
}

function messages(c: AiCall): OAMessage[] {
  // l'output JSON viene richiesto nel prompt: non tutti i provider gratuiti supportano response_format
  const system = c.schema
    ? `${c.system}\n\nRispondi ESCLUSIVAMENTE con un oggetto JSON valido (senza testo prima o dopo, senza blocchi \`\`\`) conforme a questo JSON Schema:\n${JSON.stringify(c.schema)}`
    : c.system;
  const history = (c.history ?? []).map((h: Content) => ({
    role: (h.role === "model" ? "assistant" : "user") as OAMessage["role"],
    content: convertParts(h.parts ?? []),
  }));
  const parts = typeof c.parts === "string" ? [{ text: c.parts }] : c.parts;
  return [{ role: "system", content: system }, ...history, { role: "user", content: convertParts(parts) }];
}

async function post(c: AiCall, stream: boolean) {
  const res = await fetch(`${url()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: model(),
      messages: messages(c),
      stream,
      ...(c.maxOutputTokens ? { max_tokens: Math.min(c.maxOutputTokens, 32768) } : {}),
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = body.slice(0, 300);
    try {
      const j = JSON.parse(body);
      msg = j.error?.message ?? j.message ?? msg;
    } catch {
      /* testo semplice */
    }
    throw new FreeLLMError(`FreeLLMAPI (${res.status}): ${msg}`, res.status);
  }
  const routed = res.headers.get("x-routed-via");
  return { res, model: `freellmapi:${routed || model()}` };
}

/** Risposta completa. */
export async function freeChat(c: AiCall) {
  const { res, model: used } = await post(c, false);
  const j = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = j.choices?.[0]?.message?.content ?? "";
  if (!text) throw new FreeLLMError("FreeLLMAPI ha restituito una risposta vuota.", 502);
  if (j.choices?.[0]?.finish_reason === "length") throw new FreeLLMError("Risposta troppo lunga per il modello gratuito scelto.", 502);
  return {
    text,
    model: used === "freellmapi:auto" && j.model ? `freellmapi:${j.model}` : used,
    input: j.usage?.prompt_tokens ?? 0,
    output: j.usage?.completion_tokens ?? 0,
  };
}

/** Streaming (Server-Sent Events in formato OpenAI): restituisce un generatore di pezzi di testo. */
export async function freeStream(c: AiCall) {
  const { res, model: used } = await post(c, true);
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
          /* riga incompleta o di servizio */
        }
      }
    }
  }
  return { chunks: chunks(), model: used };
}

/** Diagnostica: numero di modelli e una risposta minima. */
export async function freeDiag() {
  if (!freeEnabled()) return "non configurato (FREELLMAPI_URL e FREELLMAPI_KEY non impostate)";
  const m = await fetch(`${url()}/models`, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(20_000) });
  if (!m.ok) throw new FreeLLMError(`FreeLLMAPI /models (${m.status})`, m.status);
  const models = ((await m.json()) as { data?: unknown[] }).data?.length ?? 0;
  const r = await freeChat({ system: "Sei un assistente.", parts: "Rispondi solo con la parola OK." } as AiCall);
  return { modelli: models, modello_che_ha_risposto: r.model, testo: r.text.trim().slice(0, 40) };
}

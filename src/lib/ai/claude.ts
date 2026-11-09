import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

// Prezzi in USD per milione di token (input, output). Aggiorna se cambi modello.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

let _client: Anthropic | null = null;
export function anthropic() {
  if (!_client) _client = new Anthropic();
  return _client;
}

export class BudgetError extends Error {}
export class RefusalError extends Error {}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ClaudeCall = {
  sb: SupabaseClient;
  userId: string;
  feature: string;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[] | string;
  history?: Anthropic.Beta.BetaMessageParam[];
  schema?: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
};

/** Blocca la richiesta se il budget mensile impostato è stato superato. */
export async function assertBudget(sb: SupabaseClient, userId: string) {
  const { data: settings } = await sb
    .from("user_settings")
    .select("monthly_budget_usd")
    .eq("user_id", userId)
    .maybeSingle();
  const budget = Number(settings?.monthly_budget_usd ?? 10);
  if (budget <= 0) return;
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { data } = await sb
    .from("ai_usage")
    .select("cost_usd")
    .eq("user_id", userId)
    .gte("created_at", start.toISOString());
  const spent = (data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
  if (spent >= budget) {
    throw new BudgetError(
      `Budget mensile AI raggiunto (${spent.toFixed(2)} $ / ${budget.toFixed(2)} $). Puoi aumentarlo nelle Impostazioni.`,
    );
  }
}

export async function logUsage(
  sb: SupabaseClient,
  userId: string,
  feature: string,
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null },
) {
  const [pin, pout] = PRICES[model] ?? PRICES["claude-opus-5-5"];
  const input =
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) * 0.1 +
    (usage.cache_creation_input_tokens ?? 0) * 1.25;
  const cost = (input * pin + usage.output_tokens * pout) / 1_000_000;
  await sb.from("ai_usage").insert({
    user_id: userId,
    feature,
    model,
    input_tokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    output_tokens: usage.output_tokens,
    cost_usd: cost,
  });
}

function requestParams(c: ClaudeCall): Anthropic.Beta.MessageCreateParamsStreaming {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(c.history ?? []),
    { role: "user", content: c.content },
  ];
  return {
    model: MODEL,
    max_tokens: c.maxTokens ?? 32000,
    system: c.system,
    messages,
    thinking: { type: "adaptive" },
    output_config: {
      effort: c.effort ?? "medium",
      ...(c.schema ? { format: { type: "json_schema", schema: c.schema } } : {}),
    },
    // se un filtro di sicurezza rifiuta la richiesta, il server riprova su un modello alternativo
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    stream: true,
  } as Anthropic.Beta.MessageCreateParamsStreaming;
}

/** Chiamata completa (streaming lato server per evitare timeout) che restituisce il testo finale. */
export async function callClaude(c: ClaudeCall): Promise<string> {
  await assertBudget(c.sb, c.userId);
  const stream = anthropic().beta.messages.stream(requestParams(c));
  const msg = await stream.finalMessage();
  await logUsage(c.sb, c.userId, c.feature, msg.model, msg.usage);
  if (msg.stop_reason === "refusal") {
    throw new RefusalError("La richiesta è stata rifiutata dal modello.");
  }
  if (msg.stop_reason === "max_tokens") {
    throw new Error("Risposta troppo lunga: il documento è stato troncato. Prova a dividerlo.");
  }
  return msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Chiamata con output JSON strutturato. */
export async function callClaudeJSON<T>(c: ClaudeCall & { schema: Record<string, unknown> }): Promise<T> {
  const text = await callClaude(c);
  return JSON.parse(text) as T;
}

/** Streaming del testo verso il browser (usato dalla chat). */
export async function streamClaude(c: ClaudeCall): Promise<ReadableStream<Uint8Array>> {
  await assertBudget(c.sb, c.userId);
  const stream = anthropic().beta.messages.stream(requestParams(c));
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            controller.enqueue(enc.encode(ev.delta.text));
          }
        }
        const msg = await stream.finalMessage();
        if (msg.stop_reason === "refusal") {
          controller.enqueue(enc.encode("\n\n_La richiesta è stata rifiutata dal modello._"));
        }
        await logUsage(c.sb, c.userId, c.feature, msg.model, msg.usage);
      } catch (e) {
        controller.enqueue(enc.encode(`\n\n_Errore: ${(e as Error).message}_`));
      } finally {
        controller.close();
      }
    },
  });
}

/** Converte gli errori in una risposta JSON leggibile. */
export function aiErrorResponse(e: unknown) {
  if (e instanceof BudgetError) return Response.json({ error: e.message }, { status: 402 });
  if (e instanceof RefusalError) return Response.json({ error: e.message }, { status: 422 });
  if (e instanceof Anthropic.AuthenticationError)
    return Response.json({ error: "Chiave API Anthropic non valida o mancante." }, { status: 500 });
  if (e instanceof Anthropic.RateLimitError)
    return Response.json({ error: "Troppe richieste all'AI, riprova tra poco." }, { status: 429 });
  if (e instanceof Anthropic.BadRequestError)
    return Response.json({ error: `Richiesta non valida: ${e.message}` }, { status: 400 });
  if (e instanceof Anthropic.APIError)
    return Response.json({ error: `Errore AI (${e.status}): ${e.message}` }, { status: 502 });
  console.error(e);
  return Response.json({ error: (e as Error).message || "Errore sconosciuto" }, { status: 500 });
}

/** Scarica un file dallo storage dell'utente in base64. */
export async function storageToBase64(sb: SupabaseClient, userId: string, path: string) {
  if (!path.startsWith(`${userId}/`)) throw new Error("Percorso file non valido");
  const { data, error } = await sb.storage.from("files").download(path);
  if (error || !data) throw new Error(`Impossibile leggere il file: ${error?.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  return { base64: buf.toString("base64"), mime: data.type || "application/octet-stream", size: buf.length };
}

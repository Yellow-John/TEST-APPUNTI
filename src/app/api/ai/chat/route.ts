import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { aiErrorResponse, streamClaude } from "@/lib/ai/claude";
import { CHAT_SYSTEM } from "@/lib/ai/prompts";
import { ftsSearch } from "@/lib/ai/retrieval";
import { jsonError, requireUser } from "@/lib/server-auth";

export const maxDuration = 300;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(50_000) }))
    .min(1)
    .max(40),
  noteIds: z.array(z.string().uuid()).max(20).optional(), // note scelte esplicitamente
});

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonError("Richiesta non valida");
  const { messages, noteIds } = parsed.data;
  const question = messages[messages.length - 1].content;

  try {
    // recupero delle note pertinenti: domanda attuale + domande precedenti dell'utente
    const userText = messages.filter((m) => m.role === "user").slice(-3).map((m) => m.content);
    const hits = await ftsSearch(auth.sb, userText, 8);
    const ids = [...new Set([...(noteIds ?? []), ...hits.map((h) => h.id)])].slice(0, 10);
    let notes: { id: string; title: string; content: string }[] = [];
    if (ids.length) {
      const { data } = await auth.sb
        .from("notes")
        .select("id,title,content")
        .in("id", ids)
        .eq("is_locked", false)
        .is("deleted_at", null);
      notes = (data ?? []).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    }
    const sources = notes.map((n, i) => ({ n: i + 1, id: n.id, title: n.title || "Senza titolo" }));
    const context = notes
      .map(
        (n, i) =>
          `<nota id="${i + 1}" titolo="${(n.title || "Senza titolo").replace(/"/g, "'")}">\n${n.content.slice(0, 30000)}\n</nota>`,
      )
      .join("\n\n");

    const history: Anthropic.Beta.BetaMessageParam[] = messages
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content }));

    const stream = await streamClaude({
      sb: auth.sb,
      userId: auth.user.id,
      feature: "chat",
      system: CHAT_SYSTEM,
      history,
      content: `${context ? `I miei appunti pertinenti:\n${context}\n\n` : "(Nessun appunto pertinente trovato.)\n\n"}Domanda: ${question}`,
      effort: "medium",
      maxTokens: 16000,
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Sources": encodeURIComponent(JSON.stringify(sources)),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

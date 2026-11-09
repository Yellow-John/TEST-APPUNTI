import { z } from "zod";
import { aiErrorResponse, callAIJSON } from "@/lib/ai/gemini";
import { CORRECT_SCHEMA, correctSystem } from "@/lib/ai/prompts";
import { jsonError, requireUser } from "@/lib/server-auth";
import type { Suggestion } from "@/lib/types";

export const maxDuration = 300;

const Body = z.object({
  content: z.string().min(1).max(400_000),
  kinds: z.array(z.enum(["forma", "concetto", "lacuna"])).min(1),
});

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonError("Richiesta non valida");
  const { content, kinds } = parsed.data;
  try {
    const result = await callAIJSON<{ suggestions: Suggestion[] }>({
      sb: auth.sb,
      userId: auth.user.id,
      feature: `correzione-${kinds.join("+")}`,
      system: correctSystem(kinds),
      parts: `<appunti>\n${content}\n</appunti>`,
      schema: CORRECT_SCHEMA,
    });
    // tieni solo i suggerimenti applicabili (testo originale presente nella nota)
    const suggestions = result.suggestions.filter(
      (s) => s.original && content.includes(s.original) && s.original !== s.replacement,
    );
    return Response.json({ suggestions });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

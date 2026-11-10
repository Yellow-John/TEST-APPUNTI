import { z } from "zod";
import { aiErrorResponse, callAIJSON } from "@/lib/ai/gemini";
import { MARKDOWN_SCHEMA, noteSummarySystem } from "@/lib/ai/prompts";
import { jsonError, requireUser } from "@/lib/server-auth";

export const maxDuration = 300;
const Body = z.object({
  content: z.string().min(1).max(400_000),
  title: z.string().max(500).optional(),
  level: z.enum(["essenziale", "standard", "dettagliato"]).default("standard"),
});

// Riassunto di una nota (il testo arriva già con i segreti sostituiti da segnaposto).
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonError("Richiesta non valida");
  const { content, title, level } = parsed.data;
  try {
    const r = await callAIJSON<{ markdown: string }>({
      sb: auth.sb,
      userId: auth.user.id,
      feature: `riassunto-nota-${level}`,
      system: noteSummarySystem(level),
      parts: `${title ? `Titolo: ${title}\n\n` : ""}<appunti>\n${content}\n</appunti>`,
      schema: MARKDOWN_SCHEMA,
    });
    return Response.json(r);
  } catch (e) {
    return aiErrorResponse(e);
  }
}

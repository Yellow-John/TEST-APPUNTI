import { z } from "zod";
import { aiErrorResponse, callAIJSON } from "@/lib/ai/gemini";
import { SEARCH_SCHEMA, SEARCH_SYSTEM } from "@/lib/ai/prompts";
import { ftsSearch } from "@/lib/ai/retrieval";
import { jsonError, requireUser } from "@/lib/server-auth";

const Body = z.object({ query: z.string().min(1).max(500) });

// Ricerca per significato: l'AI espande la domanda in termini correlati, poi la ricerca full-text li classifica.
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonError("Richiesta non valida");
  try {
    const { terms } = await callAIJSON<{ terms: string[] }>({
      sb: auth.sb,
      userId: auth.user.id,
      feature: "ricerca",
      system: SEARCH_SYSTEM,
      parts: parsed.data.query,
      schema: SEARCH_SCHEMA,
      tier: "lite",
    });
    const hits = await ftsSearch(auth.sb, [parsed.data.query, ...terms], 25);
    return Response.json({ terms, hits });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

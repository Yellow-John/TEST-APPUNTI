import { z } from "zod";
import { aiErrorResponse, callAIJSON } from "@/lib/ai/gemini";
import { TAGS_SCHEMA, TAGS_SYSTEM } from "@/lib/ai/prompts";
import { jsonError, requireUser } from "@/lib/server-auth";

const Body = z.object({
  title: z.string().max(500),
  content: z.string().max(400_000),
  existingTags: z.array(z.string()).max(500),
  notebooks: z.array(z.string()).max(500),
});

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonError("Richiesta non valida");
  const { title, content, existingTags, notebooks } = parsed.data;
  try {
    const result = await callAIJSON({
      sb: auth.sb,
      userId: auth.user.id,
      feature: "tag",
      system: TAGS_SYSTEM,
      parts: `Tag esistenti: ${existingTags.join(", ") || "(nessuno)"}\nQuaderni esistenti: ${notebooks.join(", ") || "(nessuno)"}\n\nTitolo: ${title}\n\n${content.slice(0, 20000)}`,
      schema: TAGS_SCHEMA,
      tier: "lite",
    });
    return Response.json(result);
  } catch (e) {
    return aiErrorResponse(e);
  }
}

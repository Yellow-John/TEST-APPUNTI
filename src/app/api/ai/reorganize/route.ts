import { z } from "zod";
import { aiErrorResponse, callClaudeJSON } from "@/lib/ai/claude";
import { MARKDOWN_SCHEMA, REORGANIZE_SYSTEM } from "@/lib/ai/prompts";
import { jsonError, requireUser } from "@/lib/server-auth";

export const maxDuration = 300;
const Body = z.object({ content: z.string().min(1).max(400_000) });

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonError("Richiesta non valida");
  try {
    const result = await callClaudeJSON({
      sb: auth.sb,
      userId: auth.user.id,
      feature: "riordino",
      system: REORGANIZE_SYSTEM,
      content: `<appunti>\n${parsed.data.content}\n</appunti>`,
      schema: MARKDOWN_SCHEMA,
      effort: "low",
      maxTokens: 64000,
    });
    return Response.json(result);
  } catch (e) {
    return aiErrorResponse(e);
  }
}

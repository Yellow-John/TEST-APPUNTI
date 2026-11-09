import { z } from "zod";
import { aiErrorResponse, callClaude } from "@/lib/ai/claude";
import { EXPLAIN_SYSTEM } from "@/lib/ai/prompts";
import { jsonError, requireUser } from "@/lib/server-auth";

const Body = z.object({ text: z.string().min(1).max(20_000), context: z.string().max(20_000).optional() });

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonError("Richiesta non valida");
  try {
    const text = await callClaude({
      sb: auth.sb,
      userId: auth.user.id,
      feature: "spiegazione",
      system: EXPLAIN_SYSTEM,
      content: `${parsed.data.context ? `Contesto (dagli appunti):\n${parsed.data.context}\n\n` : ""}Spiegami in modo semplice:\n${parsed.data.text}`,
      effort: "low",
      maxTokens: 8000,
    });
    return Response.json({ explanation: text });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

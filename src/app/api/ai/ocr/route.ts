import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { aiErrorResponse, callClaudeJSON, storageToBase64 } from "@/lib/ai/claude";
import { OCR_SCHEMA, OCR_SYSTEM } from "@/lib/ai/prompts";
import { jsonError, requireUser } from "@/lib/server-auth";

export const maxDuration = 300;

const Body = z.object({ paths: z.array(z.string()).min(1).max(20), hint: z.string().max(500).optional() });
const IMG = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonError("Richiesta non valida");
  try {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const [i, p] of parsed.data.paths.entries()) {
      const f = await storageToBase64(auth.sb, auth.user.id, p);
      const mime = (IMG as readonly string[]).includes(f.mime) ? (f.mime as (typeof IMG)[number]) : "image/jpeg";
      content.push({ type: "text", text: `Pagina ${i} (foto ${i + 1}):` });
      content.push({ type: "image", source: { type: "base64", media_type: mime, data: f.base64 } });
    }
    content.push({
      type: "text",
      text: `Trascrivi questi appunti.${parsed.data.hint ? ` Indicazioni dell'utente: ${parsed.data.hint}` : ""}`,
    });
    const result = await callClaudeJSON({
      sb: auth.sb,
      userId: auth.user.id,
      feature: "ocr",
      system: OCR_SYSTEM,
      content,
      schema: OCR_SCHEMA,
      effort: "medium",
    });
    return Response.json(result);
  } catch (e) {
    return aiErrorResponse(e);
  }
}

import { z } from "zod";
import { type Part, aiErrorResponse, blobToInlinePart, callAIJSON, storageFile } from "@/lib/ai/gemini";
import { OCR_SCHEMA, OCR_SYSTEM } from "@/lib/ai/prompts";
import { jsonError, requireUser } from "@/lib/server-auth";

export const maxDuration = 300;

const Body = z.object({ paths: z.array(z.string()).min(1).max(20), hint: z.string().max(500).optional() });

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonError("Richiesta non valida");
  try {
    const parts: Part[] = [];
    for (const [i, p] of parsed.data.paths.entries()) {
      parts.push({ text: `Pagina ${i} (foto ${i + 1}):` });
      parts.push(await blobToInlinePart(await storageFile(auth.sb, auth.user.id, p), "image/jpeg"));
    }
    parts.push({ text: `Trascrivi questi appunti.${parsed.data.hint ? ` Indicazioni dell'utente: ${parsed.data.hint}` : ""}` });
    const result = await callAIJSON({
      sb: auth.sb,
      userId: auth.user.id,
      feature: "ocr",
      system: OCR_SYSTEM,
      parts,
      schema: OCR_SCHEMA,
    });
    return Response.json(result);
  } catch (e) {
    return aiErrorResponse(e);
  }
}

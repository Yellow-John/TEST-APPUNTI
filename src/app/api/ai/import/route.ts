import { z } from "zod";
import { type Part, aiErrorResponse, blobToInlinePart, callAIJSON, storageFile, uploadLargeFile } from "@/lib/ai/gemini";
import { DOC_SCHEMA, FULL_IMPORT_SYSTEM, smartSummarySystem } from "@/lib/ai/prompts";
import { jsonError, requireUser } from "@/lib/server-auth";

export const maxDuration = 300;

const Body = z.object({
  path: z.string().optional(), // PDF nello storage (viene eliminato dopo l'uso per risparmiare spazio)
  text: z.string().max(2_000_000).optional(), // testo già estratto (slide, docx, ...)
  filename: z.string().max(300),
  mode: z.enum(["full", "smart"]),
  level: z.enum(["essenziale", "standard", "dettagliato"]).default("standard"),
});

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success || (!parsed.data.path && !parsed.data.text)) return jsonError("Richiesta non valida");
  const { path, text, filename, mode, level } = parsed.data;
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const parts: Part[] = [];
    if (path) {
      const blob = await storageFile(auth.sb, auth.user.id, path);
      if (blob.size > 15 * 1024 * 1024) {
        const up = await uploadLargeFile(blob, "application/pdf");
        cleanup = up.cleanup;
        parts.push(up.part);
      } else {
        parts.push(await blobToInlinePart(blob, "application/pdf"));
      }
    } else {
      parts.push({ text: `<documento nome="${filename}">\n${text}\n</documento>` });
    }
    parts.push({
      text:
        mode === "smart"
          ? `Crea gli appunti intelligenti (livello ${level}) del documento "${filename}".`
          : `Converti integralmente in Markdown il documento "${filename}".`,
    });
    const result = await callAIJSON({
      sb: auth.sb,
      userId: auth.user.id,
      feature: mode === "smart" ? `riassunto-${level}` : "import",
      system: mode === "smart" ? smartSummarySystem(level) : FULL_IMPORT_SYSTEM,
      parts,
      schema: DOC_SCHEMA,
      maxOutputTokens: 65536,
    });
    return Response.json(result);
  } catch (e) {
    return aiErrorResponse(e);
  } finally {
    await cleanup?.();
    if (path) await auth.sb.storage.from("files").remove([path]).catch(() => {});
  }
}

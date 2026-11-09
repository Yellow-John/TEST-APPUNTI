import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { aiErrorResponse, callClaudeJSON, storageToBase64 } from "@/lib/ai/claude";
import { DOC_SCHEMA, FULL_IMPORT_SYSTEM, smartSummarySystem } from "@/lib/ai/prompts";
import { jsonError, requireUser } from "@/lib/server-auth";

export const maxDuration = 300;

const Body = z.object({
  path: z.string().optional(), // PDF nello storage
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
  try {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (path) {
      const f = await storageToBase64(auth.sb, auth.user.id, path);
      if (f.size > 30 * 1024 * 1024) return jsonError("PDF troppo grande (max 30 MB).");
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: f.base64 },
        title: filename,
      });
    } else {
      content.push({
        type: "document",
        source: { type: "text", media_type: "text/plain", data: text! },
        title: filename,
      });
    }
    content.push({
      type: "text",
      text:
        mode === "smart"
          ? `Crea gli appunti intelligenti (livello ${level}) del documento "${filename}".`
          : `Converti integralmente in Markdown il documento "${filename}".`,
    });
    const result = await callClaudeJSON({
      sb: auth.sb,
      userId: auth.user.id,
      feature: mode === "smart" ? `riassunto-${level}` : "import",
      system: mode === "smart" ? smartSummarySystem(level) : FULL_IMPORT_SYSTEM,
      content,
      schema: DOC_SCHEMA,
      effort: mode === "smart" ? "high" : "medium",
      maxTokens: 64000,
    });
    return Response.json(result);
  } catch (e) {
    return aiErrorResponse(e);
  }
}

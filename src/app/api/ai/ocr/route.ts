import { z } from "zod";
import { type Part, aiErrorResponse, blobToInlinePart, callAIJSON, storageFile } from "@/lib/ai/gemini";
import { handwritingParts } from "@/lib/ai/handwriting";
import { startNoteJob } from "@/lib/ai/jobs";
import { OCR_SCHEMA, OCR_SYSTEM, photoSummarySystem } from "@/lib/ai/prompts";
import { jsonError, requireUser } from "@/lib/server-auth";
import type { Figure } from "@/lib/types";

export const maxDuration = 300;

const Body = z.object({
  noteId: z.string().uuid(),
  notebookId: z.string().uuid().nullable().optional(),
  paths: z.array(z.string()).min(1).max(20),
  hint: z.string().max(500).optional(),
  mode: z.enum(["transcribe", "summary"]).default("transcribe"),
  level: z.enum(["essenziale", "standard", "dettagliato"]).default("standard"),
});

type OcrResult = { title: string; markdown: string; tags: string[]; figures: Figure[] };

// Avvia la trascrizione in background e restituisce subito la nota "in elaborazione".
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonError("Richiesta non valida");
  const { noteId, notebookId, paths, hint, mode, level } = parsed.data;
  const summary = mode === "summary";
  if (paths.some((p) => !p.startsWith(`${auth.user.id}/`))) return jsonError("Percorso file non valido");
  try {
    const note = await startNoteJob({
      sb: auth.sb,
      userId: auth.user.id,
      noteId,
      notebookId: notebookId ?? null,
      placeholderTitle: summary ? "Riassunto in corso…" : "Trascrizione in corso…",
      source: {
        type: "photo",
        files: paths,
        ...(summary ? { summary_level: level } : {}),
        job: { kind: "ocr", paths, hint, mode, level },
      },
      work: async () => {
        // campioni della grafia dell'utente come riferimento
        const parts: Part[] = await handwritingParts(auth.sb, auth.user.id).catch(() => []);
        for (const [i, p] of paths.entries()) {
          parts.push({ text: `Pagina ${i} (foto ${i + 1}):` });
          parts.push(await blobToInlinePart(await storageFile(auth.sb, auth.user.id, p), "image/jpeg"));
        }
        parts.push({ text: `${summary ? `Riassumi questi appunti (livello ${level}).` : "Trascrivi questi appunti."}${hint ? ` Indicazioni dell'utente: ${hint}` : ""}` });
        const r = await callAIJSON<OcrResult>({
          sb: auth.sb,
          userId: auth.user.id,
          feature: summary ? `riassunto-foto-${level}` : "ocr",
          system: summary ? photoSummarySystem(level) : OCR_SYSTEM,
          parts,
          schema: OCR_SCHEMA,
        });
        return {
          title: r.title,
          content: r.markdown.trim(),
          tags: r.tags.map((t) => t.toLowerCase().replace(/^#/, "")),
          source: { figures: r.figures.filter((f) => Array.isArray(f.box_2d) && f.box_2d.length === 4) },
        };
      },
    });
    return Response.json({ note }, { status: 202 });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

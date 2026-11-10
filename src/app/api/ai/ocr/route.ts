import { z } from "zod";
import { type Part, aiErrorResponse, blobToInlinePart, callAIJSON, storageFile } from "@/lib/ai/gemini";
import { handwritingParts } from "@/lib/ai/handwriting";
import { startNoteJob } from "@/lib/ai/jobs";
import { OCR_SCHEMA, OCR_SYSTEM } from "@/lib/ai/prompts";
import { jsonError, requireUser } from "@/lib/server-auth";
import type { Figure } from "@/lib/types";

export const maxDuration = 300;

const Body = z.object({
  noteId: z.string().uuid(),
  notebookId: z.string().uuid().nullable().optional(),
  paths: z.array(z.string()).min(1).max(20),
  hint: z.string().max(500).optional(),
});

type OcrResult = { title: string; markdown: string; tags: string[]; figures: Figure[] };

// Avvia la trascrizione in background e restituisce subito la nota "in elaborazione".
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonError("Richiesta non valida");
  const { noteId, notebookId, paths, hint } = parsed.data;
  if (paths.some((p) => !p.startsWith(`${auth.user.id}/`))) return jsonError("Percorso file non valido");
  try {
    const note = await startNoteJob({
      sb: auth.sb,
      userId: auth.user.id,
      noteId,
      notebookId: notebookId ?? null,
      placeholderTitle: "Trascrizione in corso…",
      source: { type: "photo", files: paths, job: { kind: "ocr", paths, hint } },
      work: async () => {
        // campioni della grafia, dizionario personale ed errori corretti in passato
        const parts: Part[] = await handwritingParts(auth.sb, auth.user.id).catch(() => []);
        for (const [i, p] of paths.entries()) {
          parts.push({ text: `Pagina ${i} (foto ${i + 1}):` });
          parts.push(await blobToInlinePart(await storageFile(auth.sb, auth.user.id, p), "image/jpeg"));
        }
        parts.push({ text: `Trascrivi questi appunti.${hint ? ` Indicazioni dell'utente: ${hint}` : ""}` });
        const r = await callAIJSON<OcrResult>({
          sb: auth.sb,
          userId: auth.user.id,
          feature: "ocr",
          system: OCR_SYSTEM,
          parts,
          schema: OCR_SCHEMA,
        });
        return {
          title: r.title,
          content: r.markdown.trim(),
          tags: r.tags.map((t) => t.toLowerCase().replace(/^#/, "")),
          source: {
            figures: r.figures.filter((f) => Array.isArray(f.box_2d) && f.box_2d.length === 4),
            ocr_original: r.markdown.trim(),
          },
        };
      },
    });
    return Response.json({ note }, { status: 202 });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

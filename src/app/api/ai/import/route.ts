import { z } from "zod";
import { type Part, aiErrorResponse, blobToInlinePart, callAIJSON, storageFile, uploadLargeFile } from "@/lib/ai/gemini";
import { startNoteJob } from "@/lib/ai/jobs";
import { DOC_SCHEMA, FULL_IMPORT_SYSTEM, smartSummarySystem } from "@/lib/ai/prompts";
import { protectSecrets } from "@/lib/secrets";
import { jsonError, requireUser } from "@/lib/server-auth";

export const maxDuration = 300;

const Body = z.object({
  noteId: z.string().uuid(),
  notebookId: z.string().uuid().nullable().optional(),
  path: z.string().optional(), // PDF nello storage (eliminato dopo un'elaborazione riuscita, per risparmiare spazio)
  text: z.string().max(2_000_000).optional(), // testo già estratto (slide, docx, ...)
  filename: z.string().max(300),
  kind: z.enum(["pdf", "slides", "import"]).default("import"),
  mode: z.enum(["full", "smart"]),
  level: z.enum(["essenziale", "standard", "dettagliato"]).default("standard"),
});

// Avvia l'importazione in background e restituisce subito la nota "in elaborazione".
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success || (!parsed.data.path && !parsed.data.text)) return jsonError("Richiesta non valida");
  const { noteId, notebookId, path, text, filename, kind, mode, level } = parsed.data;
  if (path && !path.startsWith(`${auth.user.id}/`)) return jsonError("Percorso file non valido");
  try {
    const note = await startNoteJob({
      sb: auth.sb,
      userId: auth.user.id,
      noteId,
      notebookId: notebookId ?? null,
      placeholderTitle: `${mode === "smart" ? "Riassunto" : "Importazione"} di ${filename}…`,
      source: {
        type: kind,
        summary_level: mode === "smart" ? level : undefined,
        ...(path ? { job: { kind: "import" as const, path, filename, mode, level } } : {}),
      },
      work: async () => {
        const parts: Part[] = [];
        let cleanup: (() => Promise<void>) | null = null;
        // testo di slide/Word: i segreti diventano segnaposto e vengono ripristinati nella nota
        const guard = protectSecrets(text ?? "");
        try {
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
            parts.push({ text: `<documento nome="${filename}">\n${guard.text}\n</documento>` });
          }
          parts.push({
            text:
              mode === "smart"
                ? `Crea gli appunti intelligenti (livello ${level}) del documento "${filename}".`
                : `Converti integralmente in Markdown il documento "${filename}".`,
          });
          const r = await callAIJSON<{ title: string; markdown: string; tags: string[] }>({
            sb: auth.sb,
            userId: auth.user.id,
            feature: mode === "smart" ? `riassunto-${level}` : "import",
            system: mode === "smart" ? smartSummarySystem(level) : FULL_IMPORT_SYSTEM,
            parts,
            schema: DOC_SCHEMA,
            maxOutputTokens: 65536,
          });
          return {
            title: guard.restore(r.title),
            content: guard.restore(r.markdown),
            tags: r.tags.map((t) => t.toLowerCase().replace(/^#/, "")),
            source: { job: undefined },
          };
        } finally {
          await cleanup?.();
        }
      },
      onSuccess: async () => {
        if (path) await auth.sb.storage.from("files").remove([path]);
      },
    });
    return Response.json({ note }, { status: 202 });
  } catch (e) {
    return aiErrorResponse(e);
  }
}

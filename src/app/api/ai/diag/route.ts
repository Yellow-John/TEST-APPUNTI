import { aiErrorInfo, diagChain, diagListModels, diagTry } from "@/lib/ai/gemini";
import { requireUser } from "@/lib/server-auth";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Pagina di diagnostica: apri /api/ai/diag da browser (dopo aver fatto l'accesso) e manda il risultato.
// Non mostra chiavi né dati personali. Usa al massimo 2 richieste della quota gratuita.
export async function GET() {
  const t0 = Date.now();
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const steps: Record<string, unknown> = {
    regione_vercel: process.env.VERCEL_REGION ?? "locale",
    chiave_gemini: process.env.GEMINI_API_KEY ? `presente (inizia con "${process.env.GEMINI_API_KEY.slice(0, 3)}…", ${process.env.GEMINI_API_KEY.length} caratteri)` : "MANCANTE",
    accesso_ms: Date.now() - t0,
  };

  const timed = async (name: string, fn: () => Promise<unknown>, limitMs = 120_000) => {
    const start = Date.now();
    try {
      const out = await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`nessuna risposta dopo ${limitMs / 1000} s`)), limitMs)),
      ]);
      steps[name] = { ok: true, ms: Date.now() - start, risultato: out };
    } catch (e) {
      steps[name] = { ok: false, ms: Date.now() - start, errore: aiErrorInfo(e).message };
    }
  };

  await timed("database", async () => {
    const { count, error } = await auth.sb.from("notes").select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return `${count ?? 0} note`;
  });
  await timed("modelli_disponibili", async () => (await diagListModels()).length);
  await timed("prova_compiti_pesanti", () => diagTry("main"));
  await timed("prova_compiti_leggeri", () => diagTry("lite"));
  await timed("catena_modelli", () => diagChain());

  steps.totale_ms = Date.now() - t0;
  return new Response(JSON.stringify(steps, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

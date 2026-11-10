"use client";
import { Check, CheckCheck, FileText, GraduationCap, Lightbulb, ListTree, SpellCheck, Sparkles, X, PuzzleIcon } from "lucide-react";
import { useState } from "react";
import { aiPost } from "@/lib/ai-client";
import { protectSecrets } from "@/lib/secrets";
import type { Suggestion, SummaryLevel } from "@/lib/types";
import { MarkdownView } from "../MarkdownView";

type Props = {
  content: string;
  title: string;
  getSelection: () => string;
  onApply: (next: string) => void;
  onClose: () => void;
  /** salva il riassunto come nota a parte (collegata all'originale) */
  onSaveSummary: (summary: string) => void;
  /** azione da proporre all'apertura (es. dal pulsante "Riassumi" delle note lunghe) */
  autoAction?: "summary";
};

const KIND = {
  forma: { label: "Forma", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200" },
  concetto: { label: "Concetto", cls: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200" },
  lacuna: { label: "Lacuna", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" },
} as const;

export function AiPanel({ content, title, getSelection, onApply, onClose, onSaveSummary, autoAction }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [suggestions, setSuggestions] = useState<(Suggestion & { status?: "ok" | "no" | "stale" })[] | null>(null);
  const [reorg, setReorg] = useState<string | null>(null);
  const [explain, setExplain] = useState<{ text: string; result: string } | null>(null);
  const [summary, setSummary] = useState<{ level: SummaryLevel; text: string } | null>(null);
  const [pickLevel, setPickLevel] = useState(autoAction === "summary");

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    setErr("");
    try {
      return await fn();
    } catch (e) {
      if ((e as Error).message !== "Annullato") setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const correct = (kinds: Suggestion["kind"][], key: string) =>
    run(key, async () => {
      if (!content.trim()) throw new Error("La nota è vuota.");
      const p = protectSecrets(content); // i segreti non lasciano mai l'app
      const r = await aiPost<{ suggestions: Suggestion[] }>("correct", { content: p.text, kinds }, `correzione (${kinds.join(", ")})`);
      setSummary(null);
      setSuggestions(
        r.suggestions
          .map((s) => ({ ...s, original: p.restore(s.original), replacement: p.restore(s.replacement), explanation: p.restore(s.explanation) }))
          .filter((s) => content.includes(s.original)),
      );
      setReorg(null);
      setExplain(null);
    });

  const reorganize = () =>
    run("reorg", async () => {
      if (!content.trim()) throw new Error("La nota è vuota.");
      const p = protectSecrets(content);
      const r = await aiPost<{ markdown: string }>("reorganize", { content: p.text }, "riordino automatico");
      setReorg(p.restore(r.markdown));
      setSummary(null);
      setSuggestions(null);
      setExplain(null);
    });

  const summarize = (level: SummaryLevel) =>
    run("summary", async () => {
      if (!content.trim()) throw new Error("La nota è vuota.");
      setPickLevel(false);
      const p = protectSecrets(content);
      const r = await aiPost<{ markdown: string }>("summarize", { content: p.text, title, level }, `riassunto (${level})`);
      setSummary({ level, text: p.restore(r.markdown).trim() });
      setSuggestions(null);
      setReorg(null);
      setExplain(null);
    });

  const explainSel = () =>
    run("explain", async () => {
      const sel = getSelection().trim();
      if (!sel) throw new Error("Seleziona prima nel testo il concetto da spiegare.");
      const r = await aiPost<{ explanation: string }>(
        "explain",
        { text: protectSecrets(sel).text, context: protectSecrets(content.slice(0, 8000)).text },
        "spiegazione semplificata",
      );
      setExplain({ text: sel, result: r.explanation });
      setSummary(null);
      setSuggestions(null);
      setReorg(null);
    });

  function apply(i: number, current: string): string | null {
    const s = suggestions![i];
    if (!current.includes(s.original)) return null;
    return current.replace(s.original, s.replacement);
  }

  function accept(i: number) {
    const next = apply(i, content);
    setSuggestions((prev) => prev!.map((s, j) => (j === i ? { ...s, status: next === null ? "stale" : "ok" } : s)));
    if (next !== null) onApply(next);
  }

  function acceptAll() {
    let cur = content;
    const updated = suggestions!.map((s, i) => {
      if (s.status) return s;
      const next = apply(i, cur);
      if (next === null) return { ...s, status: "stale" as const };
      cur = next;
      return { ...s, status: "ok" as const };
    });
    setSuggestions(updated);
    onApply(cur);
  }

  const pending = suggestions?.filter((s) => !s.status).length ?? 0;

  return (
    <aside className="flex h-full flex-col bg-panel" aria-label="Assistente AI">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <p className="flex items-center gap-1.5 font-semibold">
          <Sparkles size={16} className="text-accent" /> Assistente AI
        </p>
        <button className="btn-icon !h-8 !w-8" onClick={onClose} aria-label="Chiudi assistente">
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5 border-b border-line p-3">
        <ActionBtn icon={<FileText size={15} />} label="Riassumi" busy={busy === "summary"} onClick={() => setPickLevel(!pickLevel)} />
        <ActionBtn icon={<SpellCheck size={15} />} label="Correggi forma" busy={busy === "forma"} onClick={() => correct(["forma"], "forma")} />
        <ActionBtn icon={<GraduationCap size={15} />} label="Verifica concetti" busy={busy === "concetto"} onClick={() => correct(["concetto"], "concetto")} />
        <ActionBtn icon={<PuzzleIcon size={15} />} label="Trova lacune" busy={busy === "lacuna"} onClick={() => correct(["lacuna"], "lacuna")} />
        <ActionBtn icon={<CheckCheck size={15} />} label="Revisione completa" busy={busy === "all"} onClick={() => correct(["forma", "concetto", "lacuna"], "all")} />
        <ActionBtn icon={<ListTree size={15} />} label="Riordina" busy={busy === "reorg"} onClick={reorganize} />
        <ActionBtn icon={<Lightbulb size={15} />} label="Spiega selezione" busy={busy === "explain"} onClick={explainSel} />
      </div>

      {pickLevel && (
        <div className="border-b border-line p-3">
          <p className="mb-2 text-xs text-muted">Quanto deve essere sintetico il riassunto?</p>
          <div className="grid grid-cols-3 gap-1.5">
            {(["essenziale", "standard", "dettagliato"] as const).map((l) => (
              <button key={l} className="btn !px-1 text-xs capitalize" onClick={() => summarize(l)} disabled={!!busy}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Elaborazione in corso… (può richiedere fino a un minuto)
          </p>
        )}
        {err && <p className="rounded-lg bg-red-50 p-2 text-sm text-danger dark:bg-red-950/40">{err}</p>}

        {summary && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Riassunto ({summary.level})</p>
            <div className="card max-h-[50vh] overflow-y-auto p-3 text-sm">
              <MarkdownView content={summary.text} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary text-xs"
                onClick={() => {
                  const quoted = summary.text.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
                  onApply(`> **📝 Riassunto**\n>\n${quoted}\n\n---\n\n${content}`);
                  setSummary(null);
                }}
              >
                Inserisci in cima alla nota
              </button>
              <button className="btn text-xs" onClick={() => onSaveSummary(summary.text)}>
                Salva come nuova nota
              </button>
              <button className="btn text-xs" onClick={() => void navigator.clipboard.writeText(summary.text)}>
                Copia
              </button>
            </div>
          </div>
        )}

        {!busy && !suggestions && !reorg && !explain && !summary && !err && (
          <div className="space-y-2 text-sm text-muted">
            <p>Le correzioni sono sempre <b>proposte</b>: decidi tu quali applicare, una per una o tutte insieme.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><b>Riassumi</b>: solo le informazioni importanti, in tre livelli di sintesi.</li>
              <li><b>Forma</b>: ortografia, punteggiatura, abbreviazioni.</li>
              <li><b>Concetti</b>: errori o imprecisioni nei contenuti, con spiegazione.</li>
              <li><b>Lacune</b>: passaggi mancanti da integrare.</li>
              <li><b>Riordina</b>: titoli ed elenchi, senza cambiare il contenuto.</li>
              <li><b>Spiega</b>: seleziona un passaggio nell&apos;editor per una spiegazione semplice.</li>
            </ul>
          </div>
        )}

        {suggestions && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {suggestions.length === 0 ? "Nessuna correzione necessaria 🎉" : `${suggestions.length} suggerimenti`}
              </p>
              {pending > 1 && (
                <button className="btn-primary !py-1 text-xs" onClick={acceptAll}>
                  <CheckCheck size={14} /> Accetta tutti ({pending})
                </button>
              )}
            </div>
            {suggestions.map((s, i) => (
              <div key={i} className={`card p-3 text-sm ${s.status ? "opacity-55" : ""}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND[s.kind].cls}`}>{KIND[s.kind].label}</span>
                  {s.status === "ok" && <span className="text-xs text-ok">Applicato</span>}
                  {s.status === "no" && <span className="text-xs text-muted">Rifiutato</span>}
                  {s.status === "stale" && <span className="text-xs text-danger">Testo modificato, non applicabile</span>}
                </div>
                {s.kind !== "lacuna" ? (
                  <>
                    <p className="whitespace-pre-wrap rounded bg-red-50 px-2 py-1 text-red-800 line-through decoration-red-400 dark:bg-red-950/40 dark:text-red-200">{s.original}</p>
                    <p className="mt-1 whitespace-pre-wrap rounded bg-green-50 px-2 py-1 text-green-800 dark:bg-green-950/40 dark:text-green-200">{s.replacement}</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted">Dopo: «{s.original.slice(0, 120)}{s.original.length > 120 ? "…" : ""}»</p>
                    <p className="mt-1 whitespace-pre-wrap rounded bg-green-50 px-2 py-1 text-green-800 dark:bg-green-950/40 dark:text-green-200">
                      + {s.replacement.startsWith(s.original) ? s.replacement.slice(s.original.length).trim() : s.replacement}
                    </p>
                  </>
                )}
                <p className="mt-2 text-muted">{s.explanation}</p>
                {!s.status && (
                  <div className="mt-2 flex gap-2">
                    <button className="btn !py-1 text-xs text-ok" onClick={() => accept(i)}>
                      <Check size={14} /> Accetta
                    </button>
                    <button
                      className="btn !py-1 text-xs"
                      onClick={() => setSuggestions((p) => p!.map((x, j) => (j === i ? { ...x, status: "no" } : x)))}
                    >
                      <X size={14} /> Rifiuta
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {reorg && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Anteprima della nota riordinata</p>
            <div className="card max-h-[50vh] overflow-y-auto p-3 text-sm">
              <MarkdownView content={reorg} />
            </div>
            <div className="flex gap-2">
              <button className="btn-primary text-xs" onClick={() => { onApply(reorg); setReorg(null); }}>
                <Check size={14} /> Applica
              </button>
              <button className="btn text-xs" onClick={() => setReorg(null)}>
                <X size={14} /> Scarta
              </button>
            </div>
          </div>
        )}

        {explain && (
          <div className="space-y-2">
            <p className="text-xs text-muted">«{explain.text.slice(0, 200)}»</p>
            <div className="card p-3 text-sm">
              <MarkdownView content={explain.result} />
            </div>
            <button
              className="btn text-xs"
              onClick={() => onApply(`${content}\n\n> 💡 **Spiegazione semplice** — ${explain.result.replace(/\n/g, "\n> ")}\n`)}
            >
              Aggiungi in fondo alla nota
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function ActionBtn({ icon, label, busy, onClick }: { icon: React.ReactNode; label: string; busy: boolean; onClick: () => void }) {
  return (
    <button className="btn justify-start !px-2 text-xs" onClick={onClick} disabled={busy}>
      {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" /> : icon}
      {label}
    </button>
  );
}

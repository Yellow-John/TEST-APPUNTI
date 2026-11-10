"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, FileUp, Loader2, Sparkles, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/db";
import { uploadFile } from "@/lib/files";
import { extractText, importDirect } from "@/lib/importers";
import { startImportJob } from "@/lib/jobs-client";
import { createNote } from "@/lib/repo";
import type { SummaryLevel } from "@/lib/types";

type Mode = "smart" | "full" | "direct";
type Item = { name: string; status: "wait" | "work" | "done" | "error"; msg?: string; noteId?: string };

const AI_EXT = ["pdf", "pptx", "docx", "txt", "md", "html", "htm"];
const DIRECT_EXT = ["md", "markdown", "txt", "html", "htm", "enex", "docx", "pptx", "zip"];

export default function ImportPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<Mode>("smart");
  const [level, setLevel] = useState<SummaryLevel>("standard");
  const [notebookId, setNotebookId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const notebooks = (useLiveQuery(() => db.notebooks.toArray(), []) ?? []).filter((n) => !n.deleted_at);

  useEffect(() => {
    if (!sp.get("shared")) return;
    void (async () => {
      try {
        const cache = await caches.open("share-inbox");
        const out: File[] = [];
        for (const k of await cache.keys()) {
          const r = await cache.match(k);
          if (r) out.push(new File([await r.blob()], decodeURIComponent(k.url.split("/").pop() || "file"), { type: r.headers.get("content-type") || "" }));
          await cache.delete(k);
        }
        setFiles(out);
      } catch {
        /* nulla */
      }
    })();
  }, [sp]);

  const ext = (f: File) => f.name.split(".").pop()?.toLowerCase() ?? "";
  const set = (i: number, patch: Partial<Item>) => setItems((it) => it.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function run() {
    setRunning(true);
    setItems(files.map((f) => ({ name: f.name, status: "wait" })));
    let lastId: string | undefined;
    for (const [i, f] of files.entries()) {
      set(i, { status: "work" });
      try {
        const e = ext(f);
        if (mode === "direct" || !AI_EXT.includes(e)) {
          if (!DIRECT_EXT.includes(e)) throw new Error("Formato non supportato per l'importazione diretta");
          const docs = await importDirect(f);
          for (const d of docs) {
            const n = await createNote({ title: d.title, content: d.markdown, tags: d.tags ?? [], notebook_id: notebookId || null, source: { type: "import" } });
            lastId = n.id;
          }
          set(i, { status: "done", msg: e === "zip" && docs.length === 0 ? "Backup ripristinato" : `${docs.length} note create`, noteId: docs.length === 1 ? lastId : undefined });
          continue;
        }
        let id: string;
        if (e === "pdf") {
          if (f.size > 30 * 1024 * 1024) throw new Error("PDF troppo grande (max 30 MB)");
          set(i, { msg: "Caricamento… (non chiudere l'app)" });
          const path = await uploadFile(f, "imports", "pdf");
          id = await startImportJob({ path, filename: f.name, kind: "pdf", mode, level, notebookId: notebookId || null });
        } else {
          set(i, { msg: "Lettura del file…" });
          const text = await extractText(f);
          if (!text.trim()) throw new Error("Nessun testo trovato nel file");
          id = await startImportJob({ text, filename: f.name, kind: e === "pptx" ? "slides" : "import", mode, level, notebookId: notebookId || null });
        }
        lastId = id;
        set(i, { status: "done", msg: "Avviato: l'AI lo elabora in background (puoi chiudere l'app)", noteId: id });
      } catch (err) {
        set(i, { status: "error", msg: (err as Error).message });
      }
    }
    setRunning(false);
    if (files.length === 1 && lastId) router.push(`/note?id=${lastId}`);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 md:py-8">
      <h1 className="mb-1 text-2xl font-bold">Importa</h1>
      <p className="mb-5 text-sm text-muted">
        PDF, slide (.pptx), Word (.docx), Markdown, testo, HTML, Evernote (.enex), export di Notion (.zip) o un backup di questa app.
      </p>

      <button
        className="card flex w-full flex-col items-center gap-2 border-dashed p-8 text-muted transition hover:border-accent hover:text-accent"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setFiles([...e.dataTransfer.files]);
        }}
      >
        <FileUp size={32} />
        <span className="font-medium">{files.length ? files.map((f) => f.name).join(", ") : "Scegli o trascina i file"}</span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept=".pdf,.pptx,.docx,.md,.markdown,.txt,.html,.htm,.enex,.zip"
        onChange={(e) => {
          setFiles(e.target.files ? [...e.target.files] : []);
          setItems([]);
        }}
      />

      <div className="mt-5 space-y-2">
        <p className="text-sm font-medium">Come vuoi importarli?</p>
        <ModeCard
          active={mode === "smart"}
          onClick={() => setMode("smart")}
          title="✨ Riassunto intelligente"
          desc="Tiene solo le informazioni importanti, elimina ripetizioni e parti inutili e riorganizza per argomento."
        />
        {mode === "smart" && (
          <div className="ml-4 grid grid-cols-3 gap-2">
            {(["essenziale", "standard", "dettagliato"] as const).map((l) => (
              <button key={l} onClick={() => setLevel(l)} className={`btn !py-2 text-xs capitalize ${level === l ? "!border-accent !bg-accent-soft !text-accent" : ""}`}>
                {l}
              </button>
            ))}
            <p className="col-span-3 text-xs text-muted">
              {level === "essenziale" && "Solo i concetti fondamentali (~10-15% dell'originale)."}
              {level === "standard" && "Concetti chiave con le spiegazioni necessarie (~20-30%)."}
              {level === "dettagliato" && "Tutto ciò che è importante, senza ripetizioni né riempitivi (~40-50%)."}
            </p>
          </div>
        )}
        <ModeCard active={mode === "full"} onClick={() => setMode("full")} title="📄 Conversione completa (AI)" desc="Trasforma tutto il documento in testo ben formattato, senza tagliare nulla." />
        <ModeCard active={mode === "direct"} onClick={() => setMode("direct")} title="⚡ Importazione diretta" desc="Senza AI e gratis: per Markdown, Notion, Evernote, Word, HTML e backup. Non adatto ai PDF." />
      </div>

      <label className="mt-5 block text-sm">
        <span className="mb-1 block font-medium">Quaderno di destinazione</span>
        <select className="input" value={notebookId} onChange={(e) => setNotebookId(e.target.value)}>
          <option value="">Senza quaderno</option>
          {notebooks.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      </label>

      <button className="btn-primary mt-5 w-full !py-3" onClick={run} disabled={!files.length || running}>
        {running ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
        {running ? "Importazione in corso…" : `Importa ${files.length || ""} file`}
      </button>

      {items.length > 0 && (
        <ul className="card mt-5 divide-y divide-line">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2 p-3 text-sm">
              {it.status === "done" ? <CheckCircle2 size={18} className="shrink-0 text-ok" /> : it.status === "error" ? <XCircle size={18} className="shrink-0 text-danger" /> : it.status === "work" ? <Loader2 size={18} className="shrink-0 animate-spin text-accent" /> : <span className="h-[18px] w-[18px] shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{it.name}</p>
                {it.msg && <p className={it.status === "error" ? "text-danger" : "text-muted"}>{it.msg}</p>}
              </div>
              {it.noteId && <Link href={`/note?id=${it.noteId}`} className="text-accent">Apri</Link>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModeCard({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button onClick={onClick} className={`card block w-full p-3 text-left transition ${active ? "!border-accent ring-1 ring-[var(--accent)]" : "hover:border-accent"}`}>
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted">{desc}</p>
    </button>
  );
}

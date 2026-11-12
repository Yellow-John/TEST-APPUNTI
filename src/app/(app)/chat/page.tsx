"use client";
import { Eraser, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MarkdownView } from "@/components/MarkdownView";

type Source = { n: number; id: string; title: string };
type Msg = { role: "user" | "assistant"; content: string; sources?: Source[] };

const EXAMPLES = [
  "Riassumimi cosa ho annotato su Keycloak",
  "Quali passaggi ho scritto per configurare un mapper?",
  "Che differenza c'è tra OAuth2 e OpenID Connect secondo i miei appunti?",
  "Ci sono errori o passaggi mancanti nei miei appunti sul deploy?",
];

export default function ChatPage() {
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem("chat") || "[]");
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem("chat", JSON.stringify(msgs));
    } catch {
      /* ignora */
    }
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    if (!navigator.onLine) return alert("Serve una connessione a Internet.");
    const history = [...msgs, { role: "user" as const, content: text.trim() }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-20).map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({ error: `Errore ${res.status}` }));
        throw new Error(e.error);
      }
      const sources: Source[] = JSON.parse(decodeURIComponent(res.headers.get("X-Sources") || "%5B%5D"));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs([...history, { role: "assistant", content: acc, sources }]);
      }
    } catch (e) {
      setMsgs([...history, { role: "assistant", content: `_Errore: ${(e as Error).message}_` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4">
      <div className="flex items-center justify-between py-4">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Sparkles size={20} className="text-accent" /> Chiedi ai tuoi appunti
        </h1>
        {msgs.length > 0 && (
          <button className="btn-ghost text-xs" onClick={() => setMsgs([])}>
            <Eraser size={14} /> Nuova chat
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 pb-4">
        {msgs.length === 0 && (
          <div className="card p-5">
            <p className="mb-3 text-sm text-muted">Fai una domanda: cercherò la risposta nelle tue note e citerò da dove viene.</p>
            <div className="flex flex-col gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} className="btn justify-start text-left" onClick={() => setInput(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-4 py-2 text-white">
              {m.content}
            </div>
          ) : (
            <div key={i} className="card max-w-[95%] p-4">
              {m.content ? (
                <MarkdownView content={linkCitations(m.content, m.sources)} />
              ) : (
                <span className="inline-flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:.3s]" />
                </span>
              )}
              {m.sources && m.sources.length > 0 && m.content && (
                <div className="mt-3 border-t border-line pt-2">
                  <p className="mb-1 text-xs text-muted">Note consultate</p>
                  <div className="flex flex-wrap gap-1.5">
                    {m.sources.map((s) => (
                      <Link key={s.id} href={`/note?id=${s.id}`} className="chip hover:!text-accent">
                        [{s.n}] {s.title}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ),
        )}
        <div ref={end} />
      </div>

      <form
        className="sticky bottom-16 flex gap-2 bg-bg py-3 md:bottom-0"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          placeholder="Scrivi una domanda…"
          className="input max-h-40 resize-none"
          aria-label="Domanda"
        />
        <button className="btn-primary shrink-0 !px-3" disabled={busy || !input.trim()} aria-label="Invia">
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

/** Trasforma le citazioni [N] in link alla nota corrispondente. */
function linkCitations(text: string, sources?: Source[]) {
  if (!sources?.length) return text;
  return text.replace(/\[(\d+)\](?!\()/g, (m, n) => {
    const s = sources.find((x) => x.n === Number(n));
    return s ? `[\\[${n}\\]](/note?id=${s.id} "${s.title.replace(/"/g, "'")}")` : m;
  });
}

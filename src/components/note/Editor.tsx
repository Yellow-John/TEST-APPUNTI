"use client";
import {
  Bold, Code, Heading1, Heading2, Heading3, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered,
  Quote, Sigma, Table, Strikethrough,
} from "lucide-react";
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { fileUrl, uploadFile } from "@/lib/files";

export type EditorHandle = {
  getSelection: () => string;
  insert: (text: string) => void;
  focus: () => void;
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  noteTitles: string[];
  noteId: string;
};

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ value, onChange, noteTitles, noteId }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [wikiQuery, setWikiQuery] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useImperativeHandle(ref, () => ({
    getSelection: () => {
      const t = ta.current;
      return t ? value.slice(t.selectionStart, t.selectionEnd) : "";
    },
    insert: (text) => replaceSelection(text),
    focus: () => ta.current?.focus(),
  }));

  function replaceSelection(text: string, selectInner?: [number, number]) {
    const t = ta.current;
    if (!t) return onChange(value + text);
    const s = t.selectionStart;
    const e = t.selectionEnd;
    const next = value.slice(0, s) + text + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      t.focus();
      if (selectInner) t.setSelectionRange(s + selectInner[0], s + selectInner[1]);
      else t.setSelectionRange(s + text.length, s + text.length);
    });
  }

  function wrap(before: string, after = before, placeholder = "testo") {
    const t = ta.current;
    if (!t) return;
    const sel = value.slice(t.selectionStart, t.selectionEnd) || placeholder;
    replaceSelection(before + sel + after, [before.length, before.length + sel.length]);
  }

  function prefixLines(prefix: string | ((i: number) => string)) {
    const t = ta.current;
    if (!t) return;
    const start = value.lastIndexOf("\n", t.selectionStart - 1) + 1;
    const endIdx = value.indexOf("\n", t.selectionEnd);
    const end = endIdx === -1 ? value.length : endIdx;
    const block = value.slice(start, end);
    const out = block
      .split("\n")
      .map((l, i) => {
        const p = typeof prefix === "function" ? prefix(i) : prefix;
        const cleaned = l.replace(/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/, "");
        return l.startsWith(p) ? cleaned : p + cleaned;
      })
      .join("\n");
    const next = value.slice(0, start) + out + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      t.focus();
      t.setSelectionRange(start, start + out.length);
    });
  }

  async function addImages(files: FileList | File[]) {
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) continue;
        const ext = f.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
        const path = await uploadFile(f, `notes/${noteId}`, ext);
        replaceSelection(`\n![${f.name.replace(/\.[^.]+$/, "")}](${fileUrl(path)})\n`);
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function onInput(v: string) {
    onChange(v);
    const t = ta.current;
    if (!t) return;
    const before = v.slice(0, t.selectionStart);
    const m = before.match(/\[\[([^\]\n]*)$/);
    setWikiQuery(m ? m[1] : null);
  }

  const wikiOptions = useMemo(() => {
    if (wikiQuery === null) return [];
    const q = wikiQuery.toLowerCase();
    return noteTitles.filter((t) => t.toLowerCase().includes(q)).slice(0, 8);
  }, [wikiQuery, noteTitles]);

  function pickWiki(title: string) {
    const t = ta.current;
    if (!t) return;
    const pos = t.selectionStart;
    const start = value.lastIndexOf("[[", pos);
    const afterCaret = value.slice(pos);
    const closing = afterCaret.startsWith("]]") ? 2 : 0;
    const next = value.slice(0, start) + `[[${title}]]` + value.slice(pos + closing);
    onChange(next);
    setWikiQuery(null);
    requestAnimationFrame(() => {
      const p = start + title.length + 4;
      t.focus();
      t.setSelectionRange(p, p);
    });
  }

  const tools: { icon: React.ReactNode; label: string; run: () => void }[] = [
    { icon: <Heading1 size={16} />, label: "Titolo 1", run: () => prefixLines("# ") },
    { icon: <Heading2 size={16} />, label: "Titolo 2", run: () => prefixLines("## ") },
    { icon: <Heading3 size={16} />, label: "Titolo 3", run: () => prefixLines("### ") },
    { icon: <Bold size={16} />, label: "Grassetto (Ctrl+B)", run: () => wrap("**") },
    { icon: <Italic size={16} />, label: "Corsivo (Ctrl+I)", run: () => wrap("*") },
    { icon: <Strikethrough size={16} />, label: "Barrato", run: () => wrap("~~") },
    { icon: <Highlighter size={16} />, label: "Evidenzia (Ctrl+E)", run: () => wrap("==") },
    { icon: <List size={16} />, label: "Elenco puntato", run: () => prefixLines("- ") },
    { icon: <ListOrdered size={16} />, label: "Elenco numerato", run: () => prefixLines((i) => `${i + 1}. `) },
    { icon: <Quote size={16} />, label: "Citazione", run: () => prefixLines("> ") },
    { icon: <Code size={16} />, label: "Codice", run: () => wrap("\n```\n", "\n```\n", "codice") },
    { icon: <Sigma size={16} />, label: "Formula LaTeX", run: () => wrap("$", "$", "x^2") },
    { icon: <Table size={16} />, label: "Tabella", run: () => replaceSelection("\n| Colonna 1 | Colonna 2 |\n| --- | --- |\n| | |\n") },
    { icon: <Link2 size={16} />, label: "Collega a una nota [[...]]", run: () => wrap("[[", "]]", "") },
    { icon: <ImagePlus size={16} />, label: "Inserisci immagine", run: () => fileInput.current?.click() },
  ];

  return (
    <div className="relative flex h-full flex-col">
      <div className="no-print sticky top-0 z-10 flex gap-0.5 overflow-x-auto border-b border-line bg-panel/95 px-1 py-1 backdrop-blur" role="toolbar" aria-label="Formattazione">
        {tools.map((t) => (
          <button key={t.label} className="btn-icon shrink-0" title={t.label} aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={t.run}>
            {t.icon}
          </button>
        ))}
        {uploading && <span className="self-center px-2 text-xs text-muted">Caricamento…</span>}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void addImages(e.target.files);
          e.target.value = "";
        }}
      />
      <textarea
        ref={ta}
        value={value}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.ctrlKey || e.metaKey) {
            if (e.key === "b") { e.preventDefault(); wrap("**"); }
            if (e.key === "i") { e.preventDefault(); wrap("*"); }
            if (e.key === "e") { e.preventDefault(); wrap("=="); }
          }
          if (e.key === "Escape") setWikiQuery(null);
          if (e.key === "Enter" && wikiOptions.length && wikiQuery !== null) {
            e.preventDefault();
            pickWiki(wikiOptions[0]);
          }
          // continua automaticamente gli elenchi
          if (e.key === "Enter" && !e.shiftKey && wikiQuery === null) {
            const t = e.currentTarget;
            const lineStart = value.lastIndexOf("\n", t.selectionStart - 1) + 1;
            const line = value.slice(lineStart, t.selectionStart);
            const m = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
            if (m) {
              e.preventDefault();
              if (!m[3]) {
                const next = value.slice(0, lineStart) + value.slice(t.selectionStart);
                onChange(next);
                requestAnimationFrame(() => t.setSelectionRange(lineStart, lineStart));
              } else {
                const bullet = /\d+\./.test(m[2]) ? `${parseInt(m[2]) + 1}.` : m[2];
                replaceSelection(`\n${m[1]}${bullet} `);
              }
            }
          }
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
          if (files.length) {
            e.preventDefault();
            void addImages(files);
          }
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            void addImages(e.dataTransfer.files);
          }
        }}
        placeholder={"Scrivi i tuoi appunti in Markdown…\n\n# Titolo\n- elenco\n**grassetto**, ==evidenziato==, $formula$\n[[Altra nota]] per collegare"}
        className="min-h-[60vh] w-full flex-1 resize-none bg-transparent p-4 font-mono text-[0.95rem] leading-relaxed text-fg outline-none"
        spellCheck
        aria-label="Testo della nota"
      />
      {wikiOptions.length > 0 && (
        <div className="card absolute left-4 top-14 z-20 w-72 overflow-hidden shadow-lg" role="listbox">
          <p className="border-b border-line px-3 py-1.5 text-xs text-muted">Collega a una nota</p>
          {wikiOptions.map((t) => (
            <button key={t} className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-panel-2" onMouseDown={(e) => { e.preventDefault(); pickWiki(t); }}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

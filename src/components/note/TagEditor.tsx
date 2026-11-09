"use client";
import { Hash, Sparkles, X } from "lucide-react";
import { useState } from "react";

export function TagEditor({
  tags, onChange, allTags, onSuggest, suggesting,
}: {
  tags: string[]; onChange: (t: string[]) => void; allTags: string[]; onSuggest: () => void; suggesting: boolean;
}) {
  const [input, setInput] = useState("");
  const add = (t: string) => {
    const v = t.trim().replace(/^#/, "").toLowerCase();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput("");
  };
  const options = input ? allTags.filter((t) => t.includes(input.toLowerCase()) && !tags.includes(t)).slice(0, 6) : [];
  return (
    <div className="relative flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span key={t} className="chip">
          <Hash size={10} />
          {t}
          <button onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Rimuovi tag ${t}`} className="hover:text-danger">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(input);
          }
          if (e.key === "Backspace" && !input && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => input && add(input)}
        placeholder="+ tag"
        className="w-20 bg-transparent text-xs outline-none placeholder:text-muted"
        aria-label="Aggiungi tag"
      />
      <button className="chip !text-accent hover:!bg-accent-soft" onClick={onSuggest} disabled={suggesting} title="Suggerisci tag e quaderno con l'AI">
        <Sparkles size={11} /> {suggesting ? "…" : "Suggerisci"}
      </button>
      {options.length > 0 && (
        <div className="card absolute left-0 top-full z-20 mt-1 w-48 overflow-hidden shadow-lg">
          {options.map((o) => (
            <button key={o} className="block w-full px-3 py-1 text-left text-sm hover:bg-panel-2" onMouseDown={(e) => { e.preventDefault(); add(o); }}>
              #{o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Utility per collegamenti [[Titolo]] e testo semplice.

export const WIKI_RE = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;

export function extractWikiLinks(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(WIKI_RE)) out.add(m[1].trim().toLowerCase());
  return [...out];
}

/** Trasforma [[Titolo]] e ==evidenziato== in sintassi che il renderer capisce. */
export function preprocess(content: string): string {
  return content
    // "$$ formula $$" su una sola riga → formula a blocco (remark-math la tratterebbe come in linea)
    .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_m, f: string) => `$$\n${f.trim()}\n$$`)
    .replace(WIKI_RE, (_m, target: string, label?: string) => {
      const t = target.trim();
      return `[${(label ?? t).trim()}](wiki:${encodeURIComponent(t)})`;
    })
    .replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
}

export function stripMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/[#>*_`~=|-]+/g, " ")
    .replace(/\$+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

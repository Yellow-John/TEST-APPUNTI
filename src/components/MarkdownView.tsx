"use client";
import Link from "next/link";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { preprocess } from "@/lib/markdown";

type Props = {
  content: string;
  /** titolo (minuscolo) → id nota, per risolvere i collegamenti [[...]] */
  wikiIndex?: Map<string, string>;
  onMissingLink?: (title: string) => void;
  onImageClick?: (src: string) => void;
  shareToken?: string;
};

// HTML grezzo disabilitato (sicurezza); <mark> gestito a parte.
export function MarkdownView({ content, wikiIndex, onMissingLink, onImageClick, shareToken }: Props) {
  const src = preprocess(content);
  return (
    <div className="prose-note">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) => (url.startsWith("wiki:") ? url : defaultUrlTransform(url))}
        components={{
          a({ href, children }) {
            if (href?.startsWith("wiki:")) {
              const title = decodeURIComponent(href.slice(5));
              const id = wikiIndex?.get(title.toLowerCase());
              if (id)
                return (
                  <Link href={`/note?id=${id}`} className="wiki">
                    {children}
                  </Link>
                );
              return (
                <a
                  href="#"
                  className="wiki missing"
                  title="Nota non ancora creata: clicca per crearla"
                  onClick={(e) => {
                    e.preventDefault();
                    onMissingLink?.(title);
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          img({ src, alt }) {
            const s = typeof src === "string" ? src : "";
            const url = shareToken && s.startsWith("/api/file/") ? `${s}?t=${encodeURIComponent(shareToken)}` : s;
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={url} alt={alt ?? ""} loading="lazy" onClick={() => onImageClick?.(s)} className={onImageClick ? "cursor-pointer" : ""} />;
          },
          // il testo "<mark>...</mark>" prodotto dal preprocess viene reso come evidenziato
          p({ children }) {
            return <p>{renderMarks(children)}</p>;
          },
          li({ children }) {
            return <li>{renderMarks(children)}</li>;
          },
          td({ children }) {
            return <td>{renderMarks(children)}</td>;
          },
        }}
      >
        {src}
      </ReactMarkdown>
    </div>
  );
}

function renderMarks(children: React.ReactNode): React.ReactNode {
  const arr = Array.isArray(children) ? children : [children];
  const out: React.ReactNode[] = [];
  let open = false;
  let buf: React.ReactNode[] = [];
  arr.forEach((c, i) => {
    if (typeof c === "string" && (c.includes("<mark>") || c.includes("</mark>") || open)) {
      const parts = c.split(/(<mark>|<\/mark>)/);
      parts.forEach((p, j) => {
        if (p === "<mark>") open = true;
        else if (p === "</mark>") {
          out.push(<mark key={`m${i}-${j}`}>{buf}</mark>);
          buf = [];
          open = false;
        } else if (p) (open ? buf : out).push(p);
      });
    } else if (open) buf.push(c);
    else out.push(c);
  });
  if (buf.length) out.push(...buf);
  return out;
}

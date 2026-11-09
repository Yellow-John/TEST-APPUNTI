"use client";
import { useLiveQuery } from "dexie-react-hooks";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/db";
import { extractWikiLinks } from "@/lib/markdown";
import { noteTitle } from "@/lib/repo";

const EMPTY: never[] = [];

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type GNode = { id: string; name: string; val: number; color: string };

export default function GraphPage() {
  const router = useRouter();
  const notes = useLiveQuery(() => db.notes.toArray(), []) ?? EMPTY;
  const notebooks = useLiveQuery(() => db.notebooks.toArray(), []) ?? EMPTY;
  const [onlyLinked, setOnlyLinked] = useState(true);
  const [byTag, setByTag] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    const live = notes.filter((n) => !n.deleted_at && !n.is_archived);
    const palette = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444", "#22c55e", "#0ea5e9"];
    const nbColor = new Map(notebooks.map((nb, i) => [nb.id, nb.color ?? palette[i % palette.length]]));
    const byTitle = new Map(live.map((n) => [noteTitle(n).toLowerCase(), n.id]));
    const links: { source: string; target: string }[] = [];
    for (const n of live) {
      if (n.is_locked) continue;
      for (const t of extractWikiLinks(n.content)) {
        const target = byTitle.get(t);
        if (target && target !== n.id) links.push({ source: n.id, target });
      }
    }
    if (byTag) {
      // collega anche le note che condividono un tag
      const tagMap = new Map<string, string[]>();
      live.forEach((n) => n.tags.forEach((t) => tagMap.set(t, [...(tagMap.get(t) ?? []), n.id])));
      tagMap.forEach((ids) => {
        for (let i = 1; i < ids.length && i < 30; i++) links.push({ source: ids[0], target: ids[i] });
      });
    }
    const degree = new Map<string, number>();
    links.forEach((l) => {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    });
    const nodes: GNode[] = live
      .filter((n) => !onlyLinked || degree.has(n.id))
      .map((n) => ({ id: n.id, name: noteTitle(n), val: 1 + (degree.get(n.id) ?? 0), color: (n.notebook_id && nbColor.get(n.notebook_id)) || "#94a3b8" }));
    return { nodes, links };
  }, [notes, notebooks, onlyLinked, byTag]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <h1 className="text-xl font-bold">Mappa dei collegamenti</h1>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyLinked} onChange={(e) => setOnlyLinked(e.target.checked)} /> Solo note collegate
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={byTag} onChange={(e) => setByTag(e.target.checked)} /> Collega per tag
        </label>
      </div>
      <div ref={box} className="relative min-h-[400px] flex-1 overflow-hidden border-t border-line">
        {data.nodes.length === 0 ? (
          <p className="p-6 text-sm text-muted">
            Nessun collegamento ancora. Nelle note scrivi <code>[[Titolo di un&apos;altra nota]]</code> per collegarle, oppure attiva &quot;Collega per tag&quot;.
          </p>
        ) : (
          <ForceGraph2D
            width={size.w}
            height={size.h}
            graphData={data}
            nodeLabel="name"
            nodeRelSize={5}
            linkColor={() => (dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)")}
            onNodeClick={(n) => router.push(`/note?id=${(n as GNode).id}`)}
            nodeCanvasObjectMode={() => "after"}
            nodeCanvasObject={(node, ctx, scale) => {
              const n = node as GNode & { x: number; y: number };
              if (scale < 1.2 && n.val < 3) return;
              ctx.font = `${11 / scale}px sans-serif`;
              ctx.fillStyle = dark ? "#e5e5e5" : "#333";
              ctx.textAlign = "center";
              ctx.fillText(n.name.slice(0, 30), n.x, n.y + 10 / scale + Math.sqrt(n.val) * 3);
            }}
          />
        )}
      </div>
    </div>
  );
}

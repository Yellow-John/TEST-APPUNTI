"use client";
import { ArrowUpRight, Circle, Highlighter, Pen, RectangleHorizontal, RotateCcw, Square, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { compressCanvas, loadImage } from "@/lib/image";
import { fileUrl, uploadFile } from "@/lib/files";
import { Modal } from "../Modal";

type Tool = "pen" | "highlight" | "arrow" | "circle" | "rect" | "cover" | "text";
type Shape = { tool: Tool; color: string; points: [number, number][]; text?: string };

const COLORS = ["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#111827"];

/** Annotazioni su un'immagine: frecce, cerchi, riquadri, penna, evidenziatore, testo, copertura di dati sensibili. */
export function ImageAnnotator({
  src,
  noteId,
  onSave,
  onClose,
  initialTool = "arrow",
  title = "Annota immagine",
}: {
  src: string;
  noteId: string;
  /** newSrc: URL da usare nel testo; path: percorso nello storage */
  onSave: (newSrc: string, path: string) => void;
  onClose: () => void;
  initialTool?: Tool;
  title?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>(initialTool);
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const drawing = useRef<Shape | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(src)
      .then((r) => r.blob())
      .then(loadImage)
      .then(setImg)
      .catch(() => alert("Impossibile caricare l'immagine"));
  }, [src]);

  useEffect(() => draw(), [img, shapes]); // eslint-disable-line react-hooks/exhaustive-deps

  function draw(extra?: Shape) {
    const c = canvas.current;
    if (!c || !img) return;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const lw = Math.max(3, c.width / 250);
    for (const s of extra ? [...shapes, extra] : shapes) {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.tool === "highlight" ? lw * 5 : lw;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = s.tool === "highlight" ? 0.35 : 1;
      const [a, b] = [s.points[0], s.points[s.points.length - 1]];
      ctx.beginPath();
      if (s.tool === "pen" || s.tool === "highlight") {
        s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      } else if (s.tool === "cover") {
        // riquadro pieno e opaco: nasconde davvero il contenuto (il file salvato non contiene più l'originale)
        ctx.fillStyle = "#000";
        ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      } else if (s.tool === "rect") {
        ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      } else if (s.tool === "circle") {
        ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.tool === "arrow") {
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const h = lw * 5;
        ctx.beginPath();
        ctx.moveTo(b[0], b[1]);
        ctx.lineTo(b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45));
        ctx.lineTo(b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      } else if (s.tool === "text" && s.text) {
        ctx.font = `bold ${lw * 7}px sans-serif`;
        ctx.fillText(s.text, a[0], a[1]);
      }
      ctx.globalAlpha = 1;
    }
  }

  function pos(e: React.PointerEvent): [number, number] {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  }

  async function save() {
    if (!canvas.current) return;
    setSaving(true);
    try {
      const { blob, ext } = await compressCanvas(canvas.current, 0.82);
      const path = await uploadFile(blob, `notes/${noteId}`, ext);
      onSave(fileUrl(path), path);
    } catch (e) {
      alert((e as Error).message);
      setSaving(false);
    }
  }

  const tools: [Tool, React.ReactNode, string][] = [
    ["arrow", <ArrowUpRight key="a" size={16} />, "Freccia"],
    ["circle", <Circle key="c" size={16} />, "Cerchio"],
    ["rect", <Square key="r" size={16} />, "Riquadro"],
    ["pen", <Pen key="p" size={16} />, "Penna"],
    ["highlight", <Highlighter key="h" size={16} />, "Evidenziatore"],
    ["text", <Type key="t" size={16} />, "Testo"],
    ["cover", <RectangleHorizontal key="k" size={16} fill="currentColor" />, "Copri (nasconde dati sensibili)"],
  ];

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {tools.map(([t, icon, label]) => (
          <button key={t} className={`btn-icon ${tool === t ? "!bg-accent-soft !text-accent" : ""}`} onClick={() => setTool(t)} title={label} aria-label={label}>
            {icon}
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-line" />
        {COLORS.map((c) => (
          <button key={c} onClick={() => setColor(c)} aria-label={`Colore ${c}`} className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-fg" : "border-transparent"}`} style={{ background: c }} />
        ))}
        <span className="mx-1 h-6 w-px bg-line" />
        <button className="btn-icon" onClick={() => setShapes((s) => s.slice(0, -1))} title="Annulla" aria-label="Annulla">
          <RotateCcw size={16} />
        </button>
      </div>
      <div className="overflow-auto rounded-lg bg-panel-2">
        <canvas
          ref={canvas}
          className="mx-auto block max-h-[65dvh] max-w-full touch-none"
          onPointerDown={(e) => {
            const p = pos(e);
            if (tool === "text") {
              const text = prompt("Testo da inserire");
              if (text) setShapes((s) => [...s, { tool, color, points: [p], text }]);
              return;
            }
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drawing.current = { tool, color, points: [p] };
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const p = pos(e);
            if (tool === "pen" || tool === "highlight") drawing.current.points.push(p);
            else drawing.current.points = [drawing.current.points[0], p];
            draw(drawing.current);
          }}
          onPointerUp={() => {
            if (drawing.current && drawing.current.points.length > 1) setShapes((s) => [...s, drawing.current!]);
            drawing.current = null;
          }}
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>Annulla</button>
        <button className="btn-primary" onClick={save} disabled={saving || !shapes.length}>
          {saving ? "Salvataggio…" : "Salva"}
        </button>
      </div>
    </Modal>
  );
}

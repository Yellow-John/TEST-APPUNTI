"use client";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft, ArrowRight, Camera, Crop as CropIcon, ImagePlus, Loader2, RotateCw, ScanLine, Sparkles, Trash2, Wand2, X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AiError, aiPost } from "@/lib/ai-client";
import { db } from "@/lib/db";
import { fileUrl, uploadFile } from "@/lib/files";
import {
  type Adjust, type Crop, type Filter, autoCrop, canvasToBlob, compressCanvas, cropCanvas, defaultAdjust, loadImage, renderAdjusted,
} from "@/lib/image";
import { createNote } from "@/lib/repo";

type Page = { id: string; file: Blob; img: HTMLImageElement; adjust: Adjust; thumb: string };
type OcrResult = {
  title: string;
  markdown: string;
  tags: string[];
  figures: { id: number; page: number; box_2d: number[]; caption: string }[];
};

export default function CapturePage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [pages, setPages] = useState<Page[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [scanner, setScanner] = useState(false);
  const [notebookId, setNotebookId] = useState("");
  const [hint, setHint] = useState("");
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [quotaHit, setQuotaHit] = useState(false);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const notebooks = (useLiveQuery(() => db.notebooks.toArray(), []) ?? []).filter((n) => !n.deleted_at);

  useEffect(() => {
    if (sp.get("camera")) setScanner(true);
    if (sp.get("shared")) void loadShared();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadShared() {
    try {
      const cache = await caches.open("share-inbox");
      const keys = await cache.keys();
      const blobs: Blob[] = [];
      for (const k of keys) {
        const r = await cache.match(k);
        if (r) blobs.push(await r.blob());
        await cache.delete(k);
      }
      await addFiles(blobs.filter((b) => b.type.startsWith("image/")));
    } catch {
      /* niente da importare */
    }
  }

  async function addFiles(files: Blob[]) {
    const added: Page[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      const img = await loadImage(f);
      const adjust = { ...defaultAdjust(), crop: autoCrop(img) };
      added.push({ id: crypto.randomUUID(), file: f, img, adjust, thumb: thumbOf(img, adjust) });
    }
    setPages((p) => [...p, ...added]);
  }

  function updatePage(i: number, adjust: Adjust) {
    setPages((p) => p.map((pg, j) => (j === i ? { ...pg, adjust, thumb: thumbOf(pg.img, adjust) } : pg)));
  }

  function move(i: number, d: -1 | 1) {
    setPages((p) => {
      const n = [...p];
      const j = i + d;
      if (j < 0 || j >= n.length) return p;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  }

  async function transcribe() {
    if (!pages.length) return;
    setErr("");
    try {
      setStatus("Preparazione delle immagini…");
      const canvases = pages.map((p) => renderAdjusted(p.img, p.adjust, 1800));
      const folder = `scans/${new Date().toISOString().slice(0, 10)}`;
      const paths: string[] = [];
      for (const [i, c] of canvases.entries()) {
        setStatus(`Caricamento pagina ${i + 1} di ${canvases.length}…`);
        const { blob, ext } = await compressCanvas(c, 0.8);
        paths.push(await uploadFile(blob, folder, ext));
      }
      setStatus("Trascrizione con l'AI… (circa 20-60 secondi)");
      const r = await aiPost<OcrResult>("ocr", { paths, hint: hint || undefined }, `trascrizione di ${paths.length} foto`);

      let md = r.markdown;
      for (const fig of r.figures) {
        const src = canvases[fig.page] ?? canvases[0];
        setStatus(`Estrazione figura ${fig.id}…`);
        try {
          const [ymin, xmin, ymax, xmax] = fig.box_2d.map((v) => v / 1000);
          const crop = cropCanvas(src, { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin });
          const { blob, ext } = await compressCanvas(crop, 0.82);
          const p = await uploadFile(blob, folder, ext);
          md = md.replace(`[[FIGURA:${fig.id}]]`, `\n![${fig.caption}](${fileUrl(p)})\n`);
        } catch {
          md = md.replace(`[[FIGURA:${fig.id}]]`, `_[Figura: ${fig.caption}]_`);
        }
      }
      md = md.replace(/\[\[FIGURA:\d+\]\]/g, "");

      const note = await createNote({
        title: r.title,
        content: md.trim(),
        tags: r.tags.map((t) => t.toLowerCase().replace(/^#/, "")),
        notebook_id: notebookId || null,
        source: { type: "photo", files: paths },
      });
      router.replace(`/note?id=${note.id}`);
    } catch (e) {
      if (e instanceof AiError && e.status === 429) setQuotaHit(true);
      if ((e as Error).message !== "Annullato") setErr((e as Error).message);
      setStatus("");
    }
  }

  /** Riserva senza AI: OCR nel browser con Tesseract (gratis e illimitato, ma solo testo stampato). */
  async function transcribeOffline() {
    setErr("");
    try {
      setStatus("Caricamento del motore OCR… (solo la prima volta)");
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("ita+eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/core",
        langPath: "/tesseract/lang",
      });
      const texts: string[] = [];
      const canvases = pages.map((p) => renderAdjusted(p.img, p.adjust, 2200));
      for (const [i, c] of canvases.entries()) {
        setStatus(`Riconoscimento pagina ${i + 1} di ${canvases.length}…`);
        const { data } = await worker.recognize(c);
        // mantieni gli a capo del foglio (in Markdown un singolo a capo non spezza la riga)
        texts.push(data.text.trim().replace(/\n{3,}/g, "\n\n").replace(/([^\n])\n(?!\n)/g, "$1  \n"));
      }
      await worker.terminate();
      setStatus("Salvataggio…");
      const folder = `scans/${new Date().toISOString().slice(0, 10)}`;
      const paths: string[] = [];
      for (const p of pages) {
        const { blob, ext } = await compressCanvas(renderAdjusted(p.img, p.adjust, 1800), 0.8);
        paths.push(await uploadFile(blob, folder, ext));
      }
      const body = texts.map((t, i) => (texts.length > 1 ? `## Pagina ${i + 1}\n\n${t}` : t)).join("\n\n");
      const note = await createNote({
        title: "",
        content: `> Trascrizione automatica senza AI: controlla il testo, puoi migliorarlo dopo con l'assistente AI.\n\n${body}`,
        notebook_id: notebookId || null,
        source: { type: "photo", files: paths },
      });
      router.replace(`/note?id=${note.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setStatus("");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 md:py-8">
      <h1 className="mb-1 text-2xl font-bold">Fotografa i tuoi appunti</h1>
      <p className="mb-5 text-sm text-muted">Scatta o scegli una o più pagine: verranno raddrizzate, pulite dalle ombre e trasformate in testo.</p>

      <div className="grid grid-cols-3 gap-2">
        <button className="btn-primary flex-col !py-4" onClick={() => setScanner(true)}>
          <ScanLine size={22} /> Scansiona
        </button>
        <button className="btn flex-col !py-4" onClick={() => camera.current?.click()}>
          <Camera size={22} /> Fotocamera
        </button>
        <button className="btn flex-col !py-4" onClick={() => gallery.current?.click()}>
          <ImagePlus size={22} /> Galleria
        </button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { if (e.target.files) void addFiles([...e.target.files]); e.target.value = ""; }} />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void addFiles([...e.target.files]); e.target.value = ""; }} />

      {pages.length > 0 && (
        <>
          <h2 className="mt-6 mb-2 text-sm font-semibold">Pagine ({pages.length}) · tocca una pagina per modificarla</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {pages.map((p, i) => (
              <div key={p.id} className="card group relative overflow-hidden">
                <button className="block w-full" onClick={() => setEditing(i)} aria-label={`Modifica pagina ${i + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt={`Pagina ${i + 1}`} className="aspect-[3/4] w-full bg-panel-2 object-contain" />
                </button>
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white">{i + 1}</span>
                <div className="flex justify-between border-t border-line">
                  <button className="btn-icon !h-8 !w-8" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Sposta a sinistra"><ArrowLeft size={14} /></button>
                  <button className="btn-icon !h-8 !w-8 hover:!text-danger" onClick={() => setPages((ps) => ps.filter((_, j) => j !== i))} aria-label="Rimuovi pagina"><Trash2 size={14} /></button>
                  <button className="btn-icon !h-8 !w-8" onClick={() => move(i, 1)} disabled={i === pages.length - 1} aria-label="Sposta a destra"><ArrowRight size={14} /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="card mt-5 space-y-3 p-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Quaderno</span>
              <select className="input" value={notebookId} onChange={(e) => setNotebookId(e.target.value)}>
                <option value="">Senza quaderno</option>
                {notebooks.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Indicazioni per la trascrizione (facoltativo)</span>
              <input className="input" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Es. appunti di chimica organica, in inglese, ignora le scritte a margine…" />
            </label>
            {err && <p className="text-sm text-danger">{err}</p>}
            {quotaHit && !status && (
              <button className="btn w-full !py-3" onClick={transcribeOffline}>
                Trascrivi senza AI (gratis, illimitato, solo testo stampato)
              </button>
            )}
            <button className="btn-primary w-full !py-3" onClick={transcribe} disabled={!!status}>
              {status ? <><Loader2 size={18} className="animate-spin" /> {status}</> : <><Sparkles size={18} /> Trasforma in testo</>}
            </button>
          </div>
        </>
      )}

      {editing !== null && pages[editing] && (
        <PageEditor page={pages[editing]} onChange={(a) => updatePage(editing, a)} onClose={() => setEditing(null)} />
      )}
      {scanner && <Scanner onCapture={(b) => void addFiles([b])} onClose={() => setScanner(false)} count={pages.length} />}
    </div>
  );
}

function thumbOf(img: HTMLImageElement, a: Adjust) {
  return renderAdjusted(img, a, 420).toDataURL("image/jpeg", 0.7);
}

/* ---------- scansione continua con la fotocamera ---------- */
function Scanner({ onCapture, onClose, count }: { onCapture: (b: Blob) => void; onClose: () => void; count: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      })
      .catch(() => setErr("Impossibile accedere alla fotocamera. Controlla i permessi o usa il pulsante Fotocamera/Galleria."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  async function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    onCapture(await canvasToBlob(c, "image/jpeg", 0.92));
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted className="h-full w-full object-contain" />
        {flash && <div className="absolute inset-0 bg-white/70" />}
        {err && <p className="absolute inset-x-4 top-1/3 rounded-lg bg-black/70 p-4 text-center text-white">{err}</p>}
        <div className="pointer-events-none absolute inset-[8%] rounded-xl border-2 border-white/40" />
      </div>
      <div className="safe-bottom flex items-center justify-between bg-black px-6 py-4 text-white">
        <button onClick={onClose} className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10" aria-label="Chiudi fotocamera">
          <X size={22} />
        </button>
        <button onClick={shoot} className="h-18 w-18 rounded-full border-4 border-white bg-white/20 active:bg-white/60" style={{ width: 72, height: 72 }} aria-label="Scatta" />
        <button onClick={onClose} className="min-w-12 rounded-full bg-accent px-4 py-3 text-sm font-semibold">
          Fine ({count})
        </button>
      </div>
    </div>
  );
}

/* ---------- modifica di una pagina: rotazione, ritaglio, filtri ---------- */
function PageEditor({ page, onChange, onClose }: { page: Page; onChange: (a: Adjust) => void; onClose: () => void }) {
  const [a, setA] = useState<Adjust>(page.adjust);
  const [cropMode, setCropMode] = useState(false);
  const [preview, setPreview] = useState("");
  const [rotatedSrc, setRotatedSrc] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setPreview(renderAdjusted(page.img, a, 1200).toDataURL("image/jpeg", 0.8)), 80);
    return () => clearTimeout(t);
  }, [a, page.img]);

  useEffect(() => {
    const full = { ...a, crop: { x: 0, y: 0, w: 1, h: 1 }, filter: "originale" as Filter, brightness: 0, contrast: 0 };
    setRotatedSrc(renderAdjusted(page.img, full, 1200).toDataURL("image/jpeg", 0.8));
  }, [a.rotation, page.img]); // eslint-disable-line react-hooks/exhaustive-deps

  const filters: [Filter, string][] = [
    ["documento", "Documento"],
    ["bianco-nero", "Bianco/nero"],
    ["contrasto", "Contrasto"],
    ["originale", "Originale"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <button className="btn-ghost" onClick={onClose}>Annulla</button>
        <span className="font-semibold">Modifica pagina</span>
        <button className="btn-primary" onClick={() => { onChange(a); onClose(); }}>Fatto</button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-panel-2 p-3">
        {cropMode ? (
          rotatedSrc && <CropBox src={rotatedSrc} crop={a.crop} onChange={(crop) => setA({ ...a, crop })} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          preview && <img src={preview} alt="Anteprima" className="max-h-full max-w-full object-contain shadow" />
        )}
      </div>
      <div className="safe-bottom space-y-3 border-t border-line bg-panel p-3">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button className="btn" onClick={() => setA({ ...a, rotation: (((a.rotation + 90) % 360) as Adjust["rotation"]), crop: { x: 0, y: 0, w: 1, h: 1 } })}>
            <RotateCw size={15} /> Ruota
          </button>
          <button className={`btn ${cropMode ? "!border-accent !text-accent" : ""}`} onClick={() => setCropMode(!cropMode)}>
            <CropIcon size={15} /> Ritaglia
          </button>
          <button
            className="btn"
            onClick={() => {
              const c = document.createElement("canvas");
              const full = renderAdjusted(page.img, { ...a, crop: { x: 0, y: 0, w: 1, h: 1 }, filter: "originale", brightness: 0, contrast: 0 }, 800);
              c.width = full.width;
              c.height = full.height;
              const tmp = new Image();
              tmp.onload = () => setA({ ...a, crop: autoCrop(tmp) });
              tmp.src = full.toDataURL();
            }}
          >
            <Wand2 size={15} /> Auto
          </button>
        </div>
        <div className="flex justify-center gap-1.5 overflow-x-auto">
          {filters.map(([f, l]) => (
            <button key={f} onClick={() => setA({ ...a, filter: f })} className={`chip !px-3 !py-1.5 !text-xs ${a.filter === f ? "!bg-accent !text-white" : ""}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="mx-auto grid max-w-md grid-cols-2 gap-3 text-xs">
          <label>
            Luminosità
            <input type="range" min={-50} max={50} value={a.brightness} onChange={(e) => setA({ ...a, brightness: +e.target.value })} className="w-full accent-[var(--accent)]" />
          </label>
          <label>
            Contrasto
            <input type="range" min={-50} max={80} value={a.contrast} onChange={(e) => setA({ ...a, contrast: +e.target.value })} className="w-full accent-[var(--accent)]" />
          </label>
        </div>
      </div>
    </div>
  );
}

function CropBox({ src, crop, onChange }: { src: string; crop: Crop; onChange: (c: Crop) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: string; start: [number, number]; crop: Crop } | null>(null);

  function onDown(handle: string) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { handle, start: [e.clientX, e.clientY], crop };
    };
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    const r = box.current?.getBoundingClientRect();
    if (!d || !r) return;
    const dx = (e.clientX - d.start[0]) / r.width;
    const dy = (e.clientY - d.start[1]) / r.height;
    let { x, y, w, h } = d.crop;
    const min = 0.08;
    if (d.handle === "move") {
      x = Math.min(Math.max(0, x + dx), 1 - w);
      y = Math.min(Math.max(0, y + dy), 1 - h);
    } else {
      if (d.handle.includes("l")) { const nx = Math.min(Math.max(0, x + dx), x + w - min); w += x - nx; x = nx; }
      if (d.handle.includes("r")) w = Math.min(Math.max(min, w + dx), 1 - x);
      if (d.handle.includes("t")) { const ny = Math.min(Math.max(0, y + dy), y + h - min); h += y - ny; y = ny; }
      if (d.handle.includes("b")) h = Math.min(Math.max(min, h + dy), 1 - y);
    }
    onChange({ x, y, w, h });
  }

  return (
    <div ref={box} className="relative max-h-full touch-none select-none" onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Da ritagliare" className="block max-h-[60dvh] max-w-full" draggable={false} />
      <div
        className="absolute cursor-move border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
        style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
        onPointerDown={onDown("move")}
      >
        {["tl", "tr", "bl", "br"].map((hd) => (
          <span
            key={hd}
            onPointerDown={onDown(hd)}
            className="absolute h-6 w-6 rounded-full border-2 border-white bg-accent"
            style={{
              left: hd.includes("l") ? -12 : undefined,
              right: hd.includes("r") ? -12 : undefined,
              top: hd.includes("t") ? -12 : undefined,
              bottom: hd.includes("b") ? -12 : undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
}

"use client";
// Elaborazione immagini lato client: rotazione, ritaglio, filtri "documento" per togliere ombre e aumentare il contrasto.

export type Crop = { x: number; y: number; w: number; h: number }; // normalizzato 0..1
export type Filter = "originale" | "documento" | "bianco-nero" | "contrasto";
export type Adjust = { rotation: 0 | 90 | 180 | 270; crop: Crop; filter: Filter; brightness: number; contrast: number };

export const defaultAdjust = (): Adjust => ({
  rotation: 0,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  filter: "documento",
  brightness: 0,
  contrast: 0,
});

export async function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return img;
}

/** Applica rotazione + ritaglio, ridimensiona a maxSide e applica il filtro. */
export function renderAdjusted(img: HTMLImageElement, a: Adjust, maxSide = 2200): HTMLCanvasElement {
  // 1. rotazione
  const rot = document.createElement("canvas");
  const swap = a.rotation === 90 || a.rotation === 270;
  rot.width = swap ? img.naturalHeight : img.naturalWidth;
  rot.height = swap ? img.naturalWidth : img.naturalHeight;
  const rctx = rot.getContext("2d")!;
  rctx.translate(rot.width / 2, rot.height / 2);
  rctx.rotate((a.rotation * Math.PI) / 180);
  rctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

  // 2. ritaglio + ridimensionamento
  const sx = a.crop.x * rot.width;
  const sy = a.crop.y * rot.height;
  const sw = Math.max(1, a.crop.w * rot.width);
  const sh = Math.max(1, a.crop.h * rot.height);
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const out = document.createElement("canvas");
  out.width = Math.round(sw * scale);
  out.height = Math.round(sh * scale);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(rot, sx, sy, sw, sh, 0, 0, out.width, out.height);

  // 3. filtro
  applyFilter(out, a);
  return out;
}

function applyFilter(c: HTMLCanvasElement, a: Adjust) {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const { width: w, height: h } = c;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const b = a.brightness * 2.55;
  const cf = (259 * (a.contrast + 255)) / (255 * (259 - a.contrast));

  if (a.filter === "documento" || a.filter === "bianco-nero") {
    // stima dello sfondo (illuminazione) con una sfocatura grossolana, poi divisione: rimuove le ombre
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const bg = backgroundEstimate(gray, w, h);
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
      let v = (gray[p] / Math.max(bg[p], 1)) * 255;
      v = cf * (v - 128) + 128 + b;
      if (a.filter === "bianco-nero") v = v > 170 ? 255 : 0;
      else v = v > 235 ? 255 : v;
      if (a.filter === "documento") {
        // mantieni un po' del colore originale (penne colorate, evidenziatori)
        const k = gray[p] > 0 ? v / gray[p] : 1;
        d[i] = clamp(d[i] * k);
        d[i + 1] = clamp(d[i + 1] * k);
        d[i + 2] = clamp(d[i + 2] * k);
      } else {
        d[i] = d[i + 1] = d[i + 2] = clamp(v);
      }
    }
  } else {
    const extra = a.filter === "contrasto" ? (259 * (60 + 255)) / (255 * (259 - 60)) : 1;
    for (let i = 0; i < d.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        let v = d[i + k];
        v = extra * (v - 128) + 128;
        v = cf * (v - 128) + 128 + b;
        d[i + k] = clamp(v);
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function clamp(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Sfondo stimato: massimo locale su griglia ridotta + interpolazione (veloce anche su foto grandi). */
function backgroundEstimate(gray: Float32Array, w: number, h: number): Float32Array {
  const cell = Math.max(16, Math.round(Math.max(w, h) / 40));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      // 90° percentile approssimato con il massimo dei valori campionati
      let m = 0;
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y += 2)
        for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x += 2) {
          const v = gray[y * w + x];
          if (v > m) m = v;
        }
      grid[gy * gw + gx] = m;
    }
  // ammorbidisci la griglia
  const smooth = new Float32Array(grid.length);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = gy + dy;
          const xx = gx + dx;
          if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) {
            s += grid[yy * gw + xx];
            n++;
          }
        }
      smooth[gy * gw + gx] = s / n;
    }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, y / cell - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, x / cell - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const a = smooth[y0 * gw + x0] * (1 - tx) + smooth[y0 * gw + x1] * tx;
      const b2 = smooth[y1 * gw + x0] * (1 - tx) + smooth[y1 * gw + x1] * tx;
      out[y * w + x] = a * (1 - ty) + b2 * ty;
    }
  }
  return out;
}

/** Trova automaticamente il foglio: riquadro dell'area chiara più grande (approssimazione rapida). */
export function autoCrop(img: HTMLImageElement): Crop {
  const s = 200 / Math.max(img.naturalWidth, img.naturalHeight);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  const lum: number[] = [];
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    lum.push(v);
    sum += v;
  }
  const thr = sum / lum.length; // pixel più chiari della media = foglio
  const rowFrac = (y: number) => {
    let n = 0;
    for (let x = 0; x < c.width; x++) if (lum[y * c.width + x] > thr) n++;
    return n / c.width;
  };
  const colFrac = (x: number) => {
    let n = 0;
    for (let y = 0; y < c.height; y++) if (lum[y * c.width + x] > thr) n++;
    return n / c.height;
  };
  let top = 0;
  while (top < c.height - 1 && rowFrac(top) < 0.5) top++;
  let bottom = c.height - 1;
  while (bottom > top && rowFrac(bottom) < 0.5) bottom--;
  let left = 0;
  while (left < c.width - 1 && colFrac(left) < 0.5) left++;
  let right = c.width - 1;
  while (right > left && colFrac(right) < 0.5) right--;
  const crop = { x: left / c.width, y: top / c.height, w: (right - left + 1) / c.width, h: (bottom - top + 1) / c.height };
  if (crop.w < 0.3 || crop.h < 0.3) return { x: 0, y: 0, w: 1, h: 1 };
  return crop;
}

export function canvasToBlob(c: HTMLCanvasElement, type = "image/jpeg", quality = 0.88): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Conversione immagine fallita"))), type, quality));
}

/** Ritaglia una porzione (coordinate normalizzate) da un canvas. */
export function cropCanvas(src: HTMLCanvasElement, r: Crop): HTMLCanvasElement {
  const x = Math.max(0, Math.min(1, r.x)) * src.width;
  const y = Math.max(0, Math.min(1, r.y)) * src.height;
  const w = Math.max(4, Math.min(1, r.w) * src.width);
  const h = Math.max(4, Math.min(1, r.h) * src.height);
  const c = document.createElement("canvas");
  c.width = Math.round(Math.min(w, src.width - x));
  c.height = Math.round(Math.min(h, src.height - y));
  c.getContext("2d")!.drawImage(src, x, y, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

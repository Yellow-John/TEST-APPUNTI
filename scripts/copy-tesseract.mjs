// Copia in public/tesseract i file di Tesseract.js (worker, motore WebAssembly, lingue italiano+inglese),
// così l'OCR senza AI non dipende da CDN esterni e funziona anche offline.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const out = "public/tesseract";
mkdirSync(join(out, "core"), { recursive: true });
mkdirSync(join(out, "lang"), { recursive: true });

copyFileSync("node_modules/tesseract.js/dist/worker.min.js", join(out, "worker.min.js"));
const core = "node_modules/tesseract.js-core";
for (const f of readdirSync(core)) if (/-lstm\.(wasm\.js|js|wasm)$/.test(f)) copyFileSync(join(core, f), join(out, "core", f));
for (const lang of ["ita", "eng"]) {
  const src = `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`;
  if (!existsSync(src)) throw new Error(`Dati lingua mancanti: ${src}`);
  copyFileSync(src, join(out, "lang", `${lang}.traineddata.gz`));
}
console.log("Tesseract copiato in", out);

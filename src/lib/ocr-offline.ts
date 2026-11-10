"use client";
// OCR senza AI nel browser (Tesseract.js servito dall'app): gratis, illimitato, funziona offline. Adatto al testo stampato.

export async function offlineOcr(images: (HTMLCanvasElement | Blob)[], onProgress?: (msg: string) => void): Promise<string> {
  onProgress?.("Caricamento del motore OCR… (solo la prima volta)");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("ita+eng", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
  });
  const texts: string[] = [];
  try {
    for (const [i, img] of images.entries()) {
      onProgress?.(`Riconoscimento pagina ${i + 1} di ${images.length}…`);
      const { data } = await worker.recognize(img);
      // mantieni gli a capo del foglio (in Markdown un singolo a capo non spezza la riga)
      texts.push(data.text.trim().replace(/\n{3,}/g, "\n\n").replace(/([^\n])\n(?!\n)/g, "$1  \n"));
    }
  } finally {
    await worker.terminate();
  }
  const body = texts.map((t, i) => (texts.length > 1 ? `## Pagina ${i + 1}\n\n${t}` : t)).join("\n\n");
  return `> Trascrizione automatica senza AI: controlla il testo, puoi migliorarlo dopo con l'assistente AI.\n\n${body}`;
}

/* Service worker di Appunti: funzionamento offline + "Condividi con Appunti" */
const VERSION = "v3"; // cambiare per forzare l'aggiornamento di icone e pagine in cache
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const FILES = "files-v1";
const PAGES = ["/notes", "/note", "/capture", "/import", "/chat", "/graph", "/settings", "/login", "/print", "/s"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => Promise.all(PAGES.map((p) => c.add(new Request(p, { cache: "reload" })).catch(() => {})))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL, ASSETS, FILES, "share-inbox"].includes(k)).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // condivisione dal sistema operativo
  if (req.method === "POST" && url.pathname === "/share-target") {
    e.respondWith(handleShare(req));
    return;
  }
  if (req.method !== "GET") return;
  if (url.pathname.startsWith("/api/ai") || url.pathname.startsWith("/auth")) return;

  // file e immagini delle note: cache-first (sono immutabili)
  if (url.pathname.startsWith("/api/file/")) {
    e.respondWith(cacheFirst(FILES, req));
    return;
  }
  // asset statici di Next
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/tesseract/") || /\.(woff2?|png|svg|css|js)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(ASSETS, req));
    return;
  }
  // payload RSC della navigazione client: solo rete (se fallisce, Next ricarica la pagina e interviene il caso sotto)
  if (req.headers.get("RSC") === "1") return;

  // pagine: rete prima, cache se offline (le pagine sono identiche a prescindere dai parametri)
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(url.pathname, { ignoreSearch: true })) || (await caches.match("/notes")) || Response.error()),
    );
  }
});

async function cacheFirst(name, req) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function handleShare(req) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f) => typeof f !== "string");
  const cache = await caches.open("share-inbox");
  let hasImage = false;
  let i = 0;
  for (const f of files) {
    if (f.type.startsWith("image/")) hasImage = true;
    await cache.put(`/share-inbox/${Date.now()}-${i++}/${encodeURIComponent(f.name)}`, new Response(f, { headers: { "content-type": f.type } }));
  }
  const text = [form.get("title"), form.get("text"), form.get("url")].filter(Boolean).join("\n");
  if (!files.length && text) {
    return Response.redirect(`/note?new=1&text=${encodeURIComponent(text)}`, 303);
  }
  return Response.redirect(hasImage ? "/capture?shared=1" : "/import?shared=1", 303);
}

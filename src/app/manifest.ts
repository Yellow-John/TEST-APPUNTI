import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Appunti",
    short_name: "Appunti",
    description: "I tuoi appunti, dalla foto al testo, sincronizzati ovunque.",
    start_url: "/notes",
    display: "standalone",
    background_color: "#f7f6f3",
    theme_color: "#4f46e5",
    lang: "it",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Scatta appunti", short_name: "Scatta", url: "/capture?camera=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Nuova nota", short_name: "Nuova", url: "/note?new=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Chiedi ai tuoi appunti", short_name: "Chat", url: "/chat", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
    // "Condividi → Appunti" da galleria, browser, file
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "files", accept: ["image/*", "application/pdf", ".pptx", ".docx", ".md", ".txt"] }],
      },
    },
  } as MetadataRoute.Manifest;
}

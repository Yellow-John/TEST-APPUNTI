"use client";
import { uuid } from "./db";
import { supabase } from "./supabase/client";

/** Carica un file nello storage dell'utente e restituisce il percorso. */
export async function uploadFile(blob: Blob, folder: string, ext: string): Promise<string> {
  const {
    data: { user },
  } = await supabase().auth.getUser();
  if (!user) throw new Error("Devi effettuare l'accesso");
  const path = `${user.id}/${folder}/${uuid()}.${ext}`;
  const { error } = await supabase().storage.from("files").upload(path, blob, {
    contentType: blob.type || undefined,
    upsert: false,
  });
  if (error) throw new Error(`Caricamento non riuscito: ${error.message}`);
  return path;
}

/** URL stabile per visualizzare un file privato (servito da /api/file). */
export function fileUrl(path: string): string {
  return `/api/file/${path.split("/").map(encodeURIComponent).join("/")}`;
}

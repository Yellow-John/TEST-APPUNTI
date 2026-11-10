"use client";
import { supabase } from "./supabase/client";
import { type HandwritingProfile, PROFILE_FILE, emptyProfile } from "./types";

async function userId() {
  const { data } = await supabase().auth.getUser();
  if (!data.user) throw new Error("Devi effettuare l'accesso");
  return data.user.id;
}

export async function loadProfile(): Promise<HandwritingProfile> {
  const uid = await userId();
  const { data } = await supabase().storage.from("files").download(`${uid}/${PROFILE_FILE}`);
  if (!data) return emptyProfile();
  try {
    const raw = JSON.parse(await data.text()) as Partial<HandwritingProfile>;
    return { samples: Array.isArray(raw.samples) ? raw.samples : [] };
  } catch {
    return emptyProfile();
  }
}

export async function saveProfile(p: HandwritingProfile) {
  const uid = await userId();
  const blob = new Blob([JSON.stringify(p)], { type: "application/json" });
  const { error } = await supabase().storage.from("files").upload(`${uid}/${PROFILE_FILE}`, blob, { upsert: true, contentType: "application/json", cacheControl: "0" });
  if (error) throw new Error(`Salvataggio non riuscito: ${error.message}`);
}

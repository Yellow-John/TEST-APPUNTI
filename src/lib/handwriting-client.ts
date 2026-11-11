"use client";
import { supabase } from "./supabase/client";
import { type HandwritingProfile, PROFILE_FILE, emptyProfile, parseProfile } from "./types";

async function userId() {
  const { data } = await supabase().auth.getUser();
  if (!data.user) throw new Error("Devi effettuare l'accesso");
  return data.user.id;
}

export async function loadProfile(): Promise<HandwritingProfile> {
  const uid = await userId();
  const { data } = await supabase().storage.from("files").download(`${uid}/${PROFILE_FILE}`);
  if (!data) return emptyProfile();
  return parseProfile(await data.text());
}

export async function saveProfile(p: HandwritingProfile) {
  const uid = await userId();
  const blob = new Blob([JSON.stringify(p)], { type: "application/json" });
  const { error } = await supabase().storage.from("files").upload(`${uid}/${PROFILE_FILE}`, blob, { upsert: true, contentType: "application/json", cacheControl: "0" });
  if (error) throw new Error(`Salvataggio non riuscito: ${error.message}`);
}

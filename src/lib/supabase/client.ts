"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(
      SUPABASE_URL,
      SUPABASE_KEY,
    );
  }
  return client;
}

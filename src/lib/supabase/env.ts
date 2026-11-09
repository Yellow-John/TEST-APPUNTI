// URL e chiave pubblica di Supabase. Accetta sia il nome nuovo (publishable key)
// sia quello classico (anon key). I riferimenti sono statici, così Next li inserisce nel bundle del browser.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;

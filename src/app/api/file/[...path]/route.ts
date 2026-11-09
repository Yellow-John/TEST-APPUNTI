import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/env";
import { supabaseServer } from "@/lib/supabase/server";

// Serve i file privati dallo storage con un URL stabile (così il service worker può metterli in cache offline).
// Con ?t=<token> consente l'accesso alle immagini di una nota condivisa.
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const filePath = path.map(decodeURIComponent).join("/");
  const token = new URL(req.url).searchParams.get("t");

  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  let blob: Blob | null = null;
  if (user && filePath.startsWith(`${user.id}/`)) {
    const { data } = await sb.storage.from("files").download(filePath);
    blob = data;
  } else if (token && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    const { data: note } = await sb.rpc("get_shared_note", { p_token: token }).maybeSingle<{ content: string }>();
    if (note && note.content.includes(filePath)) {
      const admin = createClient(SUPABASE_URL, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!);
      const { data } = await admin.storage.from("files").download(filePath);
      blob = data;
    }
  }
  if (!blob) return new Response("Non trovato", { status: 404 });
  return new Response(blob, {
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "Cache-Control": token ? "public, max-age=3600" : "private, max-age=31536000, immutable",
    },
  });
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

// Mantiene aggiornata la sessione Supabase nei cookie per le API route.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const sb = createServerClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  await sb.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/api/:path*", "/auth/:path*"],
};

"use client";
import { BookOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

// Accesso social: compare solo se attivato sia in Supabase sia qui, ad esempio NEXT_PUBLIC_OAUTH_PROVIDERS=google
const PROVIDERS = (process.env.NEXT_PUBLIC_OAUTH_PROVIDERS ?? "").toLowerCase();
const SHOW_GOOGLE = PROVIDERS.includes("google");
const SHOW_APPLE = PROVIDERS.includes("apple");

function LoginInner() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "magic">("login");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase().auth.getSession().then(({ data }) => data.session && router.replace("/notes"));
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    setBusy(true);
    const redirect = `${location.origin}/auth/callback`;
    try {
      if (mode === "magic") {
        const { error } = await supabase().auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        setMsg("Ti abbiamo inviato un link di accesso via email.");
      } else if (mode === "signup") {
        const { data, error } = await supabase().auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        if (data.session) router.replace("/notes");
        else setMsg("Controlla la tua email per confermare l'account.");
      } else {
        const { error } = await supabase().auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/notes");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function oauth(provider: "google" | "apple") {
    const { error } = await supabase().auth.signInWithOAuth({ provider, options: { redirectTo: `${location.origin}/auth/callback` } });
    if (error) setErr(error.message);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-white">
            <BookOpen size={24} />
          </span>
          <h1 className="text-xl font-bold">Appunti</h1>
          <p className="text-sm text-muted">Dalla foto al testo, sincronizzati ovunque.</p>
        </div>

        {(SHOW_GOOGLE || SHOW_APPLE) && (
        <>
        <div className="space-y-2">
          {SHOW_GOOGLE && (
          <button className="btn w-full !py-2.5" onClick={() => oauth("google")}>
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            Continua con Google
          </button>
          )}
          {SHOW_APPLE && (
          <button className="btn w-full !py-2.5" onClick={() => oauth("apple")}>
             Continua con Apple
          </button>
          )}
        </div>

        <div className="my-4 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" /> oppure <span className="h-px flex-1 bg-line" />
        </div>
        </>
        )}

        <form className="space-y-3" onSubmit={submit}>
          <input className="input" type="email" required autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          {mode !== "magic" && (
            <input className="input" type="password" required minLength={6} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
          )}
          {err && <p className="text-sm text-danger">{err}</p>}
          {msg && <p className="text-sm text-ok">{msg}</p>}
          <button className="btn-primary w-full !py-2.5" disabled={busy}>
            {mode === "login" ? "Accedi" : mode === "signup" ? "Crea account" : "Inviami il link"}
          </button>
        </form>
        <div className="mt-4 flex flex-col items-center gap-1 text-sm">
          {mode !== "login" && <button className="text-accent" onClick={() => setMode("login")}>Accedi con password</button>}
          {mode !== "magic" && <button className="text-accent" onClick={() => setMode("magic")}>Accedi con un link via email</button>}
          {mode !== "signup" && <button className="text-muted" onClick={() => setMode("signup")}>Non hai un account? Registrati</button>}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}

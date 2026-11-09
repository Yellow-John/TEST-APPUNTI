"use client";
import type { User } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { startSync } from "@/lib/sync";
import { supabase } from "@/lib/supabase/client";

const Ctx = createContext<{ user: User | null }>({ user: null });
export const useUser = () => useContext(Ctx).user;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    // getSession legge la sessione salvata: funziona anche offline
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        setUser(data.session?.user ?? null);
        setReady(true);
        if (!data.session) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      });
    const { data: sub } = supabase().auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user) startSync(user.id);
  }, [user]);

  if (!ready || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }
  return <Ctx.Provider value={{ user }}>{children}</Ctx.Provider>;
}

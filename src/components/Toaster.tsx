"use client";
import { useEffect, useState } from "react";

export function Toaster() {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      setMsg({ text: (e as CustomEvent<string>).detail, id: Date.now() });
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 2600);
    };
    window.addEventListener("app-toast", on);
    return () => window.removeEventListener("app-toast", on);
  }, []);
  if (!msg) return null;
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 md:bottom-6" role="status" aria-live="polite">
      <div key={msg.id} className="rounded-full bg-fg px-4 py-2 text-sm text-bg shadow-lg">{msg.text}</div>
    </div>
  );
}

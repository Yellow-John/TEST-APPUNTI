"use client";
import { Camera, Home, Menu, MessageCircle, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { AppProvider } from "@/components/AppProvider";
import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/Toaster";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  return (
    <AppProvider>
      <div className="flex h-dvh overflow-hidden">
        {/* barra laterale desktop */}
        <aside className="no-print hidden w-64 shrink-0 border-r border-line bg-panel md:block">
          <Suspense>
            <Sidebar />
          </Suspense>
        </aside>

        {/* menu a scomparsa mobile */}
        {drawer && (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-panel shadow-xl">
              <button className="btn-icon absolute right-2 top-2 z-10" onClick={() => setDrawer(false)} aria-label="Chiudi menu">
                <X size={18} />
              </button>
              <Suspense>
                <Sidebar onNavigate={() => setDrawer(false)} />
              </Suspense>
            </aside>
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto pb-16 md:pb-0">
            <Suspense>{children}</Suspense>
          </div>

          {/* barra di navigazione mobile */}
          <nav className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-panel md:hidden" aria-label="Navigazione rapida">
            <BottomItem href="/notes" active={pathname === "/notes"} icon={<Home size={20} />} label="Note" />
            <BottomItem href="/chat" active={pathname === "/chat"} icon={<MessageCircle size={20} />} label="Chat" />
            <Link href="/capture?camera=1" className="flex items-center justify-center" aria-label="Scatta appunti">
              <span className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg">
                <Camera size={24} />
              </span>
            </Link>
            <BottomItem href="/note?new=1" active={false} icon={<Plus size={20} />} label="Nuova" />
            <button onClick={() => setDrawer(true)} className="flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] text-muted">
              <Menu size={20} /> Menu
            </button>
          </nav>
        </main>
      </div>
      <Toaster />
    </AppProvider>
  );
}

function BottomItem({ href, active, icon, label }: { href: string; active: boolean; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${active ? "text-accent" : "text-muted"}`}>
      {icon}
      {label}
    </Link>
  );
}

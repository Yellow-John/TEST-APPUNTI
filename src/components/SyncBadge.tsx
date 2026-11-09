"use client";
import { Cloud, CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { onSyncState, syncNow } from "@/lib/sync";

export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const [s, setS] = useState<"idle" | "syncing" | "offline" | "error">("idle");
  useEffect(() => onSyncState(setS), []);
  const map = {
    idle: { icon: Cloud, label: "Sincronizzato", cls: "text-muted" },
    syncing: { icon: RefreshCw, label: "Sincronizzazione…", cls: "text-accent animate-spin" },
    offline: { icon: CloudOff, label: "Offline: le modifiche verranno inviate al ritorno della rete", cls: "text-amber-500" },
    error: { icon: TriangleAlert, label: "Errore di sincronizzazione: tocca per riprovare", cls: "text-danger" },
  }[s];
  const Icon = map.icon;
  return (
    <button onClick={() => void syncNow()} title={map.label} aria-label={map.label} className="btn-icon">
      <Icon size={compact ? 16 : 18} className={map.cls} />
    </button>
  );
}

"use client";
import { Download, KeyRound, LogOut, Moon, Sun, SunMoon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useUser } from "@/components/AppProvider";
import { PinDialog } from "@/components/PinDialog";
import { invalidateAiSettings } from "@/lib/ai-client";
import { exportBackup } from "@/lib/export";
import { stopSyncAndClear } from "@/lib/sync";
import { supabase } from "@/lib/supabase/client";

type Usage = { feature: string; model: string; cost_usd: number; input_tokens: number; output_tokens: number; created_at: string };

export default function SettingsPage() {
  const user = useUser();
  const router = useRouter();
  const [theme, setTheme] = useState("system");
  const [confirmAi, setConfirmAi] = useState(false);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [saved, setSaved] = useState("");
  const [backup, setBackup] = useState("");
  const [pin, setPin] = useState(false);

  useEffect(() => {
    setTheme(localStorage.getItem("theme") || "system");
    supabase()
      .from("user_settings")
      .select("confirm_before_ai")
      .maybeSingle()
      .then(({ data }) => {
        if (data) setConfirmAi(data.confirm_before_ai);
      });
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    supabase()
      .from("ai_usage")
      .select("feature,model,cost_usd,input_tokens,output_tokens,created_at")
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: false })
      .then(({ data }) => setUsage((data as Usage[]) ?? []));
  }, []);

  function applyTheme(t: string) {
    setTheme(t);
    localStorage.setItem("theme", t);
    const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }
  async function saveAi() {
    const { error } = await supabase().from("user_settings").upsert({ user_id: user!.id, confirm_before_ai: confirmAi });
    invalidateAiSettings();
    setSaved(error ? `Errore: ${error.message}` : "Salvato ✓");
    setTimeout(() => setSaved(""), 2000);
  }

  const today = new Date().toDateString();
  const todayUsage = usage.filter((u) => new Date(u.created_at).toDateString() === today);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-4 md:py-8">
      <h1 className="text-2xl font-bold">Impostazioni</h1>

      <Section title="Aspetto">
        <div className="grid grid-cols-3 gap-2">
          {([["light", "Chiaro", <Sun key="s" size={16} />], ["dark", "Scuro", <Moon key="m" size={16} />], ["system", "Automatico", <SunMoon key="a" size={16} />]] as const).map(([v, l, icon]) => (
            <button key={v} onClick={() => applyTheme(v)} className={`btn !py-2 ${theme === v ? "!border-accent !bg-accent-soft !text-accent" : ""}`}>
              {icon} {l}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Intelligenza artificiale">
        <div className="mb-4 rounded-lg bg-panel-2 p-3">
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-muted">Richieste AI di oggi</p>
            <p className="text-xs text-muted">Questo mese: {usage.length}</p>
          </div>
          <p className="text-2xl font-bold">{todayUsage.length}</p>
        </div>
        <p className="mb-3 rounded-lg border border-line p-2 text-xs text-muted">
          🔒 Privacy: con i piani gratuiti i provider possono usare i contenuti inviati all&apos;AI per migliorare i loro servizi. Evita di elaborare con l&apos;AI
          appunti con dati personali o riservati (le note bloccate con PIN non vengono mai inviate).
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmAi} onChange={(e) => setConfirmAi(e.target.checked)} />
          Chiedi conferma prima di ogni elaborazione AI
        </label>
        <div className="mt-3 flex items-center gap-3">
          <button className="btn-primary" onClick={saveAi}>Salva</button>
          <span className="text-sm text-muted">{saved}</span>
        </div>
      </Section>

      <Section title="Sicurezza">
        <p className="mb-2 text-sm text-muted">Le note bloccate sono cifrate sul dispositivo con il tuo PIN. Il PIN non è recuperabile.</p>
        <button className="btn" onClick={() => setPin(true)}>
          <KeyRound size={16} /> Imposta o verifica il PIN
        </button>
      </Section>

      <Section title="Backup">
        <p className="mb-2 text-sm text-muted">
          Scarica un archivio .zip con tutte le note (Markdown + immagini + file di ripristino). Puoi salvarlo su Google Drive, Dropbox o dove preferisci, e reimportarlo da &quot;Importa&quot;.
        </p>
        <button className="btn" onClick={async () => { setBackup("Preparazione…"); await exportBackup(setBackup); setBackup(""); }} disabled={!!backup}>
          <Download size={16} /> {backup || "Scarica backup completo"}
        </button>
      </Section>


      <Section title="Account">
        <p className="mb-3 text-sm">{user?.email}</p>
        <button
          className="btn text-danger"
          onClick={async () => {
            if (!confirm("Uscire? Le modifiche non ancora sincronizzate su questo dispositivo andranno perse.")) return;
            await supabase().auth.signOut();
            await stopSyncAndClear();
            router.replace("/login");
          }}
        >
          <LogOut size={16} /> Esci
        </button>
      </Section>

      {pin && <PinDialog onKey={() => { setPin(false); alert("PIN valido ✓"); }} onClose={() => setPin(false)} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

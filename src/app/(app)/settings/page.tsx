"use client";
import { Download, KeyRound, LogOut, Moon, Smartphone, Sun, Monitor } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useUser } from "@/components/AppProvider";
import { PinDialog } from "@/components/PinDialog";
import { invalidateAiSettings } from "@/lib/ai-client";
import { exportBackup } from "@/lib/export";
import { stopSyncAndClear } from "@/lib/sync";
import { supabase } from "@/lib/supabase/client";

type Usage = { feature: string; cost_usd: number; input_tokens: number; output_tokens: number; created_at: string };

export default function SettingsPage() {
  const user = useUser();
  const router = useRouter();
  const [theme, setTheme] = useState("system");
  const [font, setFont] = useState(1);
  const [budget, setBudget] = useState(10);
  const [confirmAi, setConfirmAi] = useState(false);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [saved, setSaved] = useState("");
  const [backup, setBackup] = useState("");
  const [pin, setPin] = useState(false);
  const [installEvt, setInstallEvt] = useState<Event & { prompt?: () => void } | null>(null);

  useEffect(() => {
    setTheme(localStorage.getItem("theme") || "system");
    setFont(Number(localStorage.getItem("fontScale") || 1));
    supabase()
      .from("user_settings")
      .select("monthly_budget_usd,confirm_before_ai")
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setBudget(Number(data.monthly_budget_usd));
          setConfirmAi(data.confirm_before_ai);
        }
      });
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    supabase()
      .from("ai_usage")
      .select("feature,cost_usd,input_tokens,output_tokens,created_at")
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: false })
      .then(({ data }) => setUsage((data as Usage[]) ?? []));
    const h = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  function applyTheme(t: string) {
    setTheme(t);
    localStorage.setItem("theme", t);
    const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }
  function applyFont(f: number) {
    setFont(f);
    localStorage.setItem("fontScale", String(f));
    document.documentElement.style.setProperty("--font-scale", String(f));
  }
  async function saveAi() {
    const { error } = await supabase().from("user_settings").upsert({ user_id: user!.id, monthly_budget_usd: budget, confirm_before_ai: confirmAi });
    invalidateAiSettings();
    setSaved(error ? `Errore: ${error.message}` : "Salvato ✓");
    setTimeout(() => setSaved(""), 2000);
  }

  const total = usage.reduce((s, u) => s + Number(u.cost_usd), 0);
  const byFeature = Object.entries(
    usage.reduce<Record<string, { n: number; cost: number }>>((m, u) => {
      const k = u.feature.split("-")[0];
      m[k] = { n: (m[k]?.n ?? 0) + 1, cost: (m[k]?.cost ?? 0) + Number(u.cost_usd) };
      return m;
    }, {}),
  ).sort((a, b) => b[1].cost - a[1].cost);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-4 md:py-8">
      <h1 className="text-2xl font-bold">Impostazioni</h1>

      <Section title="Aspetto">
        <div className="grid grid-cols-3 gap-2">
          {([["light", "Chiaro", <Sun key="s" size={16} />], ["dark", "Scuro", <Moon key="m" size={16} />], ["system", "Automatico", <Monitor key="a" size={16} />]] as const).map(([v, l, icon]) => (
            <button key={v} onClick={() => applyTheme(v)} className={`btn !py-2 ${theme === v ? "!border-accent !bg-accent-soft !text-accent" : ""}`}>
              {icon} {l}
            </button>
          ))}
        </div>
        <label className="mt-4 block text-sm">
          Dimensione del testo: {Math.round(font * 100)}%
          <input type="range" min={0.85} max={1.4} step={0.05} value={font} onChange={(e) => applyFont(+e.target.value)} className="w-full accent-[var(--accent)]" />
        </label>
      </Section>

      <Section title="Intelligenza artificiale e costi">
        <div className="mb-4 rounded-lg bg-panel-2 p-3">
          <p className="text-sm text-muted">Speso questo mese</p>
          <p className="text-2xl font-bold">
            {total.toFixed(2)} $ <span className="text-sm font-normal text-muted">/ {budget.toFixed(2)} $</span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, budget > 0 ? (total / budget) * 100 : 0)}%` }} />
          </div>
          {byFeature.length > 0 && (
            <table className="mt-3 w-full text-xs">
              <tbody>
                {byFeature.map(([f, v]) => (
                  <tr key={f} className="border-t border-line">
                    <td className="py-1 capitalize">{f}</td>
                    <td className="py-1 text-right text-muted">{v.n} richieste</td>
                    <td className="py-1 text-right">{v.cost.toFixed(3)} $</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <label className="block text-sm">
          Budget mensile massimo (USD, 0 = nessun limite)
          <input type="number" min={0} step={1} value={budget} onChange={(e) => setBudget(+e.target.value)} className="input mt-1" />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm">
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

      <Section title="App">
        {installEvt ? (
          <button className="btn" onClick={() => installEvt.prompt?.()}>
            <Smartphone size={16} /> Installa l&apos;app su questo dispositivo
          </button>
        ) : (
          <p className="text-sm text-muted">
            Per installarla: su Android/Chrome usa &quot;Installa app&quot; dal menu; su iPhone apri in Safari → Condividi → &quot;Aggiungi a Home&quot;.
          </p>
        )}
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

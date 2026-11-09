"use client";
import { useEffect, useState } from "react";
import { deriveKey, makePinCheck, newSalt, pinSession, verifyPin } from "@/lib/crypto";
import { supabase } from "@/lib/supabase/client";
import { Modal } from "./Modal";

/** Chiede il PIN (o lo crea la prima volta) e restituisce la chiave di cifratura. */
export function PinDialog({ onKey, onClose }: { onKey: (k: CryptoKey) => void; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"loading" | "create" | "enter">("loading");
  const [settings, setSettings] = useState<{ pin_salt: string; pin_check: string } | null>(null);

  useEffect(() => {
    void supabase()
      .from("user_settings")
      .select("pin_salt,pin_check")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.pin_salt && data?.pin_check) {
          setSettings(data as { pin_salt: string; pin_check: string });
          localStorage.setItem("pinSettings", JSON.stringify(data));
          setMode("enter");
        } else {
          const cached = localStorage.getItem("pinSettings");
          if (cached) {
            setSettings(JSON.parse(cached));
            setMode("enter");
          } else setMode("create");
        }
      });
  }, []);

  async function submit() {
    setErr("");
    if (pin.length < 4) return setErr("Il PIN deve avere almeno 4 cifre.");
    setBusy(true);
    try {
      if (mode === "create") {
        if (pin !== pin2) throw new Error("I due PIN non coincidono.");
        const salt = newSalt();
        const key = await deriveKey(pin, salt);
        const check = await makePinCheck(key);
        const { data: u } = await supabase().auth.getUser();
        const { error } = await supabase().from("user_settings").upsert({ user_id: u.user!.id, pin_salt: salt, pin_check: check });
        if (error) throw new Error(error.message);
        localStorage.setItem("pinSettings", JSON.stringify({ pin_salt: salt, pin_check: check }));
        pinSession.set(key);
        onKey(key);
      } else {
        const key = await deriveKey(pin, settings!.pin_salt);
        if (!(await verifyPin(key, settings!.pin_check))) throw new Error("PIN errato.");
        pinSession.set(key);
        onKey(key);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === "create" ? "Crea il PIN per le note private" : "Inserisci il PIN"} onClose={onClose}>
      {mode === "loading" ? (
        <p className="text-sm text-muted">Caricamento…</p>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {mode === "create" && (
            <p className="text-sm text-muted">
              Il PIN cifra le note bloccate direttamente sul tuo dispositivo. <b>Se lo dimentichi, le note bloccate non sono recuperabili.</b>
            </p>
          )}
          <input className="input text-center text-lg tracking-[0.5em]" type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" aria-label="PIN" />
          {mode === "create" && (
            <input className="input text-center text-lg tracking-[0.5em]" type="password" inputMode="numeric" autoComplete="off" value={pin2} onChange={(e) => setPin2(e.target.value)} placeholder="Ripeti PIN" aria-label="Ripeti PIN" />
          )}
          {err && <p className="text-sm text-danger">{err}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Verifica…" : mode === "create" ? "Crea PIN" : "Sblocca"}
          </button>
        </form>
      )}
    </Modal>
  );
}

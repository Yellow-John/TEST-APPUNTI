"use client";
import { ImagePlus, Loader2, RotateCcw, RotateCw, Save, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fileUrl, uploadFile } from "@/lib/files";
import { loadProfile, saveProfile } from "@/lib/handwriting-client";
import { type Adjust, autoCrop, compressCanvas, defaultAdjust, loadImage, renderAdjusted } from "@/lib/image";
import type { HandwritingProfile } from "@/lib/types";

const ALPHABET_TEMPLATE =
  "Alfabeto completo scritto a mano dall'utente, in ordine: prima lo stampatello minuscolo (a b c d e f g h i j k l m n o p q r s t u v w x y z), poi lo stampatello maiuscolo (A B C D E F G H I J K L M N O P Q R S T U V W X Y Z), poi il corsivo minuscolo (a b c d e f g h i j k l m n o p q r s t u v w x y z). Ogni lettera compare una volta, in ordine alfabetico, andando a capo quando finisce la riga.";

type Draft = { img: HTMLImageElement; adjust: Adjust; preview: string };

export default function HandwritingPage() {
  const [profile, setProfile] = useState<HandwritingProfile | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftDesc, setDraftDesc] = useState(ALPHABET_TEMPLATE);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadProfile()
      .then(setProfile)
      .catch((e) => setMsg((e as Error).message));
  }, []);

  async function persist(p: HandwritingProfile, okMsg = "Salvato ✓") {
    setBusy("save");
    setMsg("");
    try {
      await saveProfile(p);
      setProfile(p);
      setMsg(okMsg);
      setTimeout(() => setMsg(""), 2500);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function pick(file: File) {
    const img = await loadImage(file);
    const adjust: Adjust = { ...defaultAdjust(), crop: autoCrop(img) };
    setDraft({ img, adjust, preview: renderAdjusted(img, adjust, 1000).toDataURL("image/jpeg", 0.8) });
  }

  function rotate(d: 90 | -90) {
    if (!draft) return;
    const rotation = (((draft.adjust.rotation + d + 360) % 360) as Adjust["rotation"]);
    const adjust = { ...draft.adjust, rotation, crop: { x: 0, y: 0, w: 1, h: 1 } };
    setDraft({ ...draft, adjust, preview: renderAdjusted(draft.img, adjust, 1000).toDataURL("image/jpeg", 0.8) });
  }

  async function addSample() {
    if (!draft || !profile) return;
    setBusy("upload");
    try {
      const { blob, ext } = await compressCanvas(renderAdjusted(draft.img, draft.adjust, 1600), 0.85);
      const path = await uploadFile(blob, "profile/samples", ext);
      await persist({ ...profile, samples: [...profile.samples, { path, description: draftDesc.trim() }] }, "Campione aggiunto ✓");
      setDraft(null);
      setDraftDesc("");
    } catch (e) {
      setMsg((e as Error).message);
      setBusy("");
    }
  }

  if (!profile) return <div className="p-8 text-muted">{msg || "Caricamento…"}</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-4 md:py-8">
      <div>
        <h1 className="text-2xl font-bold">La mia grafia</h1>
        <p className="mt-1 text-sm text-muted">
          Questi riferimenti vengono inviati all&apos;AI insieme a ogni foto da trascrivere, così impara a leggere la tua scrittura. Più sono precisi, migliore è il
          riconoscimento.
        </p>
      </div>

      {/* campioni */}
      <section className="card p-4">
        <h2 className="font-semibold">Campioni della tua scrittura</h2>
        <p className="mb-3 mt-1 text-sm text-muted">
          Fotografa un foglio con l&apos;alfabeto (stampatello minuscolo, maiuscolo e corsivo) o una pagina di appunti, e scrivi cosa c&apos;è scritto. Ne vengono usati al
          massimo 3.
        </p>
        <div className="space-y-3">
          {profile.samples.map((s, i) => (
            <div key={s.path} className="flex gap-3 rounded-lg border border-line p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(s.path)} alt={`Campione ${i + 1}`} className="h-24 w-24 shrink-0 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <textarea
                  className="input min-h-[5rem] text-xs"
                  value={s.description}
                  onChange={(e) => setProfile({ ...profile, samples: profile.samples.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })}
                  aria-label={`Contenuto del campione ${i + 1}`}
                />
                {i >= 3 && <p className="mt-1 text-xs text-amber-600">Oltre il 3° campione non viene usato.</p>}
              </div>
              <button
                className="btn-icon shrink-0 hover:!text-danger"
                aria-label="Elimina campione"
                onClick={() => confirm("Eliminare questo campione?") && persist({ ...profile, samples: profile.samples.filter((_, j) => j !== i) })}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        {draft ? (
          <div className="mt-4 space-y-3 rounded-lg border border-accent p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Nuovo campione: raddrizzalo in modo che si legga orizzontale</p>
              <button className="btn-icon" onClick={() => setDraft(null)} aria-label="Annulla">
                <X size={16} />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draft.preview} alt="Anteprima" className="max-h-72 w-full rounded bg-panel-2 object-contain" />
            <div className="flex justify-center gap-2">
              <button className="btn" onClick={() => rotate(-90)}><RotateCcw size={15} /> Ruota</button>
              <button className="btn" onClick={() => rotate(90)}><RotateCw size={15} /> Ruota</button>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Cosa c&apos;è scritto (trascrizione esatta o descrizione)</span>
              <textarea className="input min-h-[6rem] text-xs" value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="btn text-xs" onClick={() => setDraftDesc(ALPHABET_TEMPLATE)}>Usa modello &quot;alfabeto&quot;</button>
              <button className="btn-primary ml-auto" onClick={addSample} disabled={!!busy || !draftDesc.trim()}>
                {busy === "upload" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Aggiungi campione
              </button>
            </div>
          </div>
        ) : (
          <button className="btn mt-3 w-full !py-2.5" onClick={() => input.current?.click()}>
            <ImagePlus size={16} /> Aggiungi un campione
          </button>
        )}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files?.[0]) void pick(e.target.files[0]); e.target.value = ""; }} />
      </section>

      {msg && <p className="sticky bottom-20 rounded-lg bg-panel-2 p-2 text-center text-sm md:bottom-4">{msg}</p>}
    </div>
  );
}

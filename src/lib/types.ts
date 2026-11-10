export type Notebook = {
  id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type Figure = { id: number; page: number; box_2d: number[]; caption: string };

/** Parametri per ripetere un'elaborazione AI fallita. */
export type NoteJob =
  | { kind: "ocr"; paths: string[]; hint?: string }
  | { kind: "import"; path: string; filename: string; mode: "full" | "smart"; level: SummaryLevel };

export type NoteSource = {
  type?: "manual" | "photo" | "pdf" | "import" | "slides";
  files?: string[]; // percorsi nello storage
  summary_level?: "essenziale" | "standard" | "dettagliato";
  /** elaborazione AI in background: in corso o fallita */
  status?: "processing" | "error";
  error?: string;
  error_code?: string;
  job?: NoteJob;
  /** figure da ritagliare dalle foto (fatto dal browser all'apertura della nota) */
  figures?: Figure[];
  /** testo prodotto dalla trascrizione, per imparare dalle correzioni dell'utente */
  ocr_original?: string;
};

export type Note = {
  id: string;
  notebook_id: string | null;
  title: string;
  content: string;
  tags: string[];
  is_favorite: boolean;
  is_pinned: boolean;
  is_archived: boolean;
  is_locked: boolean;
  locked_payload: string | null;
  source: NoteSource;
  share_token: string | null;
  share_mode: "view" | "edit" | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type Suggestion = {
  kind: "forma" | "concetto" | "lacuna";
  original: string;
  replacement: string;
  explanation: string;
};

export type SummaryLevel = "essenziale" | "standard" | "dettagliato";

/** Profilo della grafia dell'utente: usato come riferimento in ogni trascrizione (salvato nello storage). */
export type HandwritingSample = { path: string; description: string };
export type HandwritingCorrection = { wrong: string; right: string; at: string };
export type HandwritingProfile = {
  samples: HandwritingSample[];
  notes: string; // osservazioni libere, es. "la mia r sembra una v"
  glossary: string[]; // parole e nomi usati spesso
  corrections: HandwritingCorrection[]; // errori di lettura corretti in passato
};
export const emptyProfile = (): HandwritingProfile => ({ samples: [], notes: "", glossary: [], corrections: [] });
export const PROFILE_FILE = "profile/handwriting.json";

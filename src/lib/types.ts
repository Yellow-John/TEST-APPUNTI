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

export type NoteSource = {
  type?: "manual" | "photo" | "pdf" | "import" | "slides";
  files?: string[]; // percorsi nello storage
  summary_level?: "essenziale" | "standard" | "dettagliato";
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

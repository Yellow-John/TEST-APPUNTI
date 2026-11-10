// Rilevamento di dati sensibili nel testo (password, token, chiavi...). Funziona nel browser e sul server.
// Usato per avvisare l'utente e per NON inviare mai segreti all'AI (vengono sostituiti da segnaposto).

export type SecretFinding = { kind: string; label: string; start: number; end: number; value: string };

type Rule = { kind: string; label: string; re: RegExp; group?: number };

// group: indice del gruppo che contiene il valore segreto (il resto della corrispondenza resta visibile)
const RULES: Rule[] = [
  { kind: "private-key", label: "Chiave privata", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { kind: "aws", label: "Chiave AWS", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "github", label: "Token GitHub", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: "gitlab", label: "Token GitLab", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "slack", label: "Token Slack", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "google", label: "Chiave API Google", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "stripe", label: "Chiave Stripe", re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/g },
  { kind: "llm", label: "Chiave API AI", re: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-or-v1-[A-Za-z0-9]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|gsk_[A-Za-z0-9]{20,}|csk-[A-Za-z0-9]{20,}|freellmapi-[A-Za-z0-9_-]{16,}|hf_[A-Za-z0-9]{30,})\b/g },
  { kind: "supabase", label: "Chiave Supabase", re: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}\b/g },
  { kind: "jwt", label: "Token JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: "bearer", label: "Token di accesso", re: /\bBearer\s+([A-Za-z0-9._~+/=-]{20,})/g, group: 1 },
  // protocollo://utente:password@host
  { kind: "conn", label: "Password in un indirizzo", re: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@]+:([^\s@/]{3,})@[^\s]+/gi, group: 1 },
  // password: valore / client secret = valore / api key: valore / token: valore (anche in italiano)
  {
    kind: "assignment",
    label: "Password o segreto",
    re: /\b(?:password|passwd|pwd|pass|passphrase|parola\s+chiave|secret|client[\s_-]?secret|segreto|api[\s_-]?key|apikey|access[\s_-]?key|secret[\s_-]?key|private[\s_-]?key|token|access[\s_-]?token|refresh[\s_-]?token|auth[\s_-]?token|chiave(?:\s+api)?|credenziali?|pin)\b["']?\s*(?:[:=]|=>|è|e'|->)\s*["'`]?([^\s"'`,;]{4,})/gi,
    group: 1,
  },
];

// valori che sembrano segnaposto e non segreti veri
const PLACEHOLDER = /^(?:\*+|•+|x{3,}|\.{3,}|…|<[^>]*>|\{[^}]*\}|\$\{[^}]*\}|\$[A-Z_]+|%[A-Z_]+%|changeme|password|secret|token|example|esempio|todo|tbd|null|none|undefined|true|false|\[[^\]]*\]|⟦[^⟧]*⟧|(?:la|il|una?|mia|tua|sua|nostra|vostra)\b.*)$/i;

/** Trova i segreti nel testo (senza sovrapposizioni, in ordine). */
export function detectSecrets(text: string): SecretFinding[] {
  const found: SecretFinding[] = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) {
      const value = r.group ? m[r.group] : m[0];
      if (!value || PLACEHOLDER.test(value)) continue;
      // valori brevi solo numerici/parole comuni per le assegnazioni: richiedi un minimo di "casualità"
      if (r.kind === "assignment" && !/[0-9]/.test(value) && !/[^A-Za-zÀ-ÿ]/.test(value) && value.length < 10) continue;
      const start = (m.index ?? 0) + (r.group ? m[0].indexOf(value) : 0);
      found.push({ kind: r.kind, label: r.label, start, end: start + value.length, value });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: SecretFinding[] = [];
  for (const f of found) if (!out.some((o) => f.start < o.end && f.end > o.start)) out.push(f);
  return out;
}

/** Versione mascherata per la visualizzazione: primi 2 caratteri e pallini. */
export function maskValue(v: string) {
  if (v.includes("\n")) return "•••• (chiave privata)";
  return v.slice(0, 2) + "•".repeat(Math.min(12, Math.max(4, v.length - 2)));
}

/** Sostituisce definitivamente i segreti con ••••. */
export function redactSecrets(text: string, findings = detectSecrets(text)): string {
  let out = "";
  let last = 0;
  for (const f of findings) {
    out += text.slice(last, f.start) + "••••••••";
    last = f.end;
  }
  return out + text.slice(last);
}

/**
 * Protezione condivisa tra più testi della stessa richiesta (stesso valore → stesso segnaposto ⟦SEGRETO_n⟧).
 * `restore` rimette i valori originali nella risposta dell'AI.
 */
export function createProtector() {
  const values: string[] = [];
  const protect = (text: string) => {
    let out = "";
    let last = 0;
    for (const f of detectSecrets(text)) {
      let i = values.indexOf(f.value);
      if (i < 0) i = values.push(f.value) - 1;
      out += text.slice(last, f.start) + `⟦SEGRETO_${i + 1}⟧`;
      last = f.end;
    }
    return out + text.slice(last);
  };
  const restore = (s: string) => s.replace(/⟦SEGRETO_(\d+)⟧/g, (m, n) => values[Number(n) - 1] ?? m);
  return { protect, restore, count: () => values.length };
}

/** Prima di inviare un testo all'AI: i segreti diventano ⟦SEGRETO_n⟧. */
export function protectSecrets(text: string) {
  const p = createProtector();
  const out = p.protect(text);
  return { text: out, count: p.count(), restore: p.restore };
}

/** Ripristina i segreti in una risposta in streaming (un segnaposto può arrivare spezzato tra due pezzi). */
export function restoreStream(stream: ReadableStream<Uint8Array>, restore: (s: string) => string): ReadableStream<Uint8Array> {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buf += dec.decode(chunk, { stream: true });
        const open = buf.lastIndexOf("⟦");
        const keep = open >= 0 && buf.indexOf("⟧", open) < 0 && buf.length - open < 20 ? buf.slice(open) : "";
        const ready = keep ? buf.slice(0, buf.length - keep.length) : buf;
        if (ready) controller.enqueue(enc.encode(restore(ready)));
        buf = keep;
      },
      flush(controller) {
        buf += dec.decode();
        if (buf) controller.enqueue(enc.encode(restore(buf)));
      },
    }),
  );
}

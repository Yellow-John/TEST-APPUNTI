# Appunti

App web installabile (PWA) per PC e telefono, sincronizzata in tempo reale, che trasforma le foto dei tuoi appunti in testo e li migliora con l'AI. **Costo: zero.**

**Stack (tutto su piani gratuiti):** Next.js 15 su Vercel Hobby · Supabase Free (database, login, file, realtime) · Google Gemini API (piano gratuito) · Tesseract.js (OCR nel browser) · IndexedDB per l'offline.

## Funzionalità

| Area | Cosa fa |
|---|---|
| **Acquisizione** | Scansione continua dalla fotocamera, scatto singolo o galleria · più pagine in un'unica nota · ritaglio automatico/manuale, rotazione, rimozione ombre, filtri documento/B&N/contrasto · riconoscimento della scrittura a mano · formule convertite in LaTeX, tabelle in tabelle, disegni ritagliati e inseriti come immagini |
| **Importazione** | PDF, slide (.pptx), Word, Markdown, HTML, Evernote (.enex), export di Notion (.zip), backup · **Riassunto intelligente** (essenziale / standard / dettagliato): tiene solo le informazioni importanti ed elimina le ripetizioni · conversione completa · importazione diretta senza AI |
| **AI** | Correzione della forma · verifica dei concetti · lacune da integrare: tutte come proposte da accettare/rifiutare, con spiegazione · riordino automatico · spiegazione semplice di un passaggio selezionato · chat con i tuoi appunti con citazioni · tag e quaderno suggeriti |
| **Organizzazione** | Quaderni e sotto-quaderni, tag, collegamenti `[[Nota]]` con autocompletamento, note che rimandano a questa, mappa a grafo · ricerca istantanea (anche offline) e ricerca per significato · preferiti, note fissate in alto, archivio, cestino |
| **Editor** | Markdown con barra degli strumenti, evidenziatore `==testo==`, LaTeX, codice, tabelle · vista modifica / divisa / lettura · incolla o trascina immagini · annotazioni sulle immagini (frecce, cerchi, riquadri, penna, evidenziatore, testo) |
| **Piattaforma** | Funziona offline e sincronizza al ritorno della rete · sincronizzazione in tempo reale tra dispositivi · installabile · "Condividi → Appunti" da galleria/browser · scorciatoie "Scatta", "Nuova", "Chat" · tema scuro, dimensione del testo |
| **Condivisione** | Link in sola lettura o modificabile, commenti con citazione |
| **Esportazione** | PDF, Word, Markdown, backup .zip completo (da salvare su Drive/Dropbox) |
| **Sicurezza** | Login con email/password, link via email, Google, Apple · note cifrate con PIN sul dispositivo (AES-256), mai inviate all'AI · contatore delle richieste AI, conferma prima di ogni elaborazione |

## Installazione (circa 15 minuti)

### 1. Supabase
1. Crea un progetto gratuito su [supabase.com](https://supabase.com).
2. **SQL Editor** → incolla ed esegui il contenuto di `supabase/migrations/0001_init.sql`.
3. **Authentication → URL Configuration**: imposta *Site URL* sull'indirizzo dell'app (es. `https://appunti.vercel.app`) e aggiungi `https://appunti.vercel.app/auth/callback` e `http://localhost:3000/auth/callback` nei *Redirect URLs*.
4. (Facoltativo) **Authentication → Providers**: attiva Google e/o Apple.
5. Dopo aver creato il tuo account, in **Authentication → Sign In / Providers** disattiva *Allow new users to sign up*: così l'app resta solo tua.

### 2. Chiave Gemini (gratuita)
1. Vai su [aistudio.google.com](https://aistudio.google.com) con il tuo account Google → **Get API key** → **Create API key**.
2. **Non attivare la fatturazione** (*billing*) sul progetto: senza fatturazione Google non può addebitare nulla; quando la quota gratuita finisce, le richieste vengono semplicemente rifiutate fino al giorno dopo.

### 3. Avvio in locale
```bash
cp .env.example .env.local   # poi compila i valori
npm install
npm run dev
```
Apri http://localhost:3000.

### 4. Pubblicazione (Vercel)
1. Carica il progetto su GitHub e importalo su [vercel.com](https://vercel.com).
2. Inserisci le stesse variabili di `.env.local` in *Settings → Environment Variables*.
3. Apri l'URL dal telefono → menu del browser → **Installa app** (Android) o **Condividi → Aggiungi a Home** (iPhone).

Il file `vercel.json` attiva un controllo automatico giornaliero (`/api/keepalive`) che impedisce a Supabase di mettere in pausa il progetto gratuito dopo 7 giorni senza uso.

> Le elaborazioni lunghe (PDF di molte pagine) possono richiedere alcuni minuti: le route AI hanno `maxDuration = 300`. Sul piano gratuito di Vercel il limite effettivo dipende dalla configurazione (*Fluid compute*).

## Costi: zero, con questi limiti
| Servizio | Limite del piano gratuito | Cosa succede se lo superi |
|---|---|---|
| **Gemini** | Un numero di richieste al giorno che Google cambia nel tempo (lo vedi in AI Studio → *Rate limits*) | L'app passa al modello "lite"; se anche quello è esaurito ti avvisa. Le foto si possono trascrivere senza AI con l'OCR nel browser (buono per il testo stampato, scarso con la scrittura a mano). La quota si rinnova ogni giorno |
| **Supabase** | 500 MB di database (decine di migliaia di note), 1 GB di file | Le foto sono compresse (WebP, circa 100-350 KB a pagina: oltre 3.000 pagine in 1 GB) e i PDF importati vengono cancellati dopo l'elaborazione |
| **Vercel** | Uso personale, funzioni fino a 300 secondi | Un PDF molto lungo può superare il tempo massimo: dividilo in parti |

**Privacy:** con il piano gratuito di Gemini, Google può usare i contenuti inviati all'AI (e farli leggere a revisori umani) per migliorare i suoi servizi. Le note bloccate con PIN non vengono mai inviate all'AI; evita di elaborare con l'AI appunti con dati personali o riservati.

## Più AI gratuita con FreeLLMAPI (facoltativo)
[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) è un proxy open source che riunisce dietro un unico indirizzo i piani gratuiti di molti provider (Groq, Cerebras, OpenRouter, Mistral, Cloudflare, Cohere, NVIDIA e altri). L'app lo usa come ulteriore riserva quando tutti i modelli Gemini sono esauriti o occupati, oppure come prima scelta con `FREELLMAPI_MODE=first`.

1. Installa FreeLLMAPI su un computer o server sempre acceso (Node 20+ o Docker) e rendilo raggiungibile via HTTPS.
2. Nella sua dashboard aggiungi le chiavi gratuite dei provider che vuoi usare e crea la chiave unica (`freellmapi-…`).
3. Su Vercel imposta `FREELLMAPI_URL` (es. `https://tuo-server/v1`) e `FREELLMAPI_KEY`, poi ripubblica.

Limiti: i PDF restano su Gemini, perché FreeLLMAPI non accetta documenti; foto, testo, slide e Word funzionano. La qualità dipende dal modello che il router sceglie. Restano valide le condizioni d'uso di ogni provider. `/api/ai/diag` mostra se FreeLLMAPI risponde e quale modello ha usato.

## Architettura in breve
- **Offline-first:** tutte le letture passano da IndexedDB (Dexie). Le modifiche vanno in una coda (`outbox`) e vengono inviate a Supabase appena c'è rete (`src/lib/sync.ts`).
- **Conflitti:** vince l'ultima modifica, grazie a un trigger nel database che ignora gli aggiornamenti più vecchi di quelli salvati.
- **Realtime:** Supabase notifica le modifiche fatte dagli altri dispositivi.
- **AI:** solo lato server (`src/app/api/ai/*` → `src/lib/ai/gemini.ts`), con la chiave mai esposta al browser. I compiti pesanti (foto, PDF, correzioni, chat) usano il modello Flash, quelli leggeri (tag, ricerca, spiegazioni) Flash-Lite, per far durare di più la quota. Se il modello principale esaurisce la quota, la richiesta viene ripetuta su quello leggero.
- **File:** bucket privato `files`. Le immagini sono servite da `/api/file/...`, così il service worker può tenerle in cache per l'offline.

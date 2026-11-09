# Appunti

App web installabile (PWA) per PC e telefono, sincronizzata in tempo reale, che trasforma le foto dei tuoi appunti in testo e li migliora con l'AI (Claude).

**Stack:** Next.js 15 · Supabase (database, login, file, realtime) · Claude API · IndexedDB per l'offline.

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
| **Sicurezza e costi** | Login con email/password, link via email, Google, Apple · note cifrate con PIN sul dispositivo (AES-256) · budget mensile per l'AI, registro dei costi, conferma prima di ogni elaborazione |

## Installazione (circa 15 minuti)

### 1. Supabase
1. Crea un progetto gratuito su [supabase.com](https://supabase.com).
2. **SQL Editor** → incolla ed esegui il contenuto di `supabase/migrations/0001_init.sql`.
3. **Authentication → URL Configuration**: imposta *Site URL* sull'indirizzo dell'app (es. `https://appunti.vercel.app`) e aggiungi `https://appunti.vercel.app/auth/callback` e `http://localhost:3000/auth/callback` nei *Redirect URLs*.
4. (Facoltativo) **Authentication → Providers**: attiva Google e/o Apple.
5. Dopo aver creato il tuo account, in **Authentication → Sign In / Providers** disattiva *Allow new users to sign up*: così l'app resta solo tua.

### 2. Chiave Anthropic
Crea una chiave su [console.anthropic.com](https://console.anthropic.com) e ricarica qualche euro di credito.

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

> Le elaborazioni lunghe (PDF di molte pagine) possono richiedere alcuni minuti: le route AI hanno `maxDuration = 300`. Sul piano gratuito di Vercel il limite effettivo dipende dalla configurazione (*Fluid compute*).

## Costi indicativi
Con il modello predefinito (Claude Opus 5.5: 4 $ per milione di token in input, 20 $ in output):
- foto di una pagina di appunti → circa 1-3 centesimi
- riassunto intelligente di un PDF di 30 pagine → circa 10-30 centesimi
- correzione di una nota → meno di 1 centesimo

Per spendere meno imposta `ANTHROPIC_MODEL=claude-sonnet-5-5` (circa la metà). Il budget mensile si imposta in **Impostazioni**.

## Architettura in breve
- **Offline-first:** tutte le letture passano da IndexedDB (Dexie). Le modifiche vanno in una coda (`outbox`) e vengono inviate a Supabase appena c'è rete (`src/lib/sync.ts`).
- **Conflitti:** vince l'ultima modifica, grazie a un trigger nel database che ignora gli aggiornamenti più vecchi di quelli salvati.
- **Realtime:** Supabase notifica le modifiche fatte dagli altri dispositivi.
- **AI:** solo lato server (`src/app/api/ai/*`), con la chiave mai esposta al browser. Ogni chiamata viene registrata con il suo costo, e il budget viene controllato prima di procedere.
- **File:** bucket privato `files`. Le immagini sono servite da `/api/file/...`, così il service worker può tenerle in cache per l'offline.

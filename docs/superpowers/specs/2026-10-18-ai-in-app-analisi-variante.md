# Analisi di variante — l'AI dentro l'app: chi la fa girare e chi la paga

Data: 2026-10-18 · Stato: analisi per decidere, non un design approvato.
Contesto: v1.1 del servizio MCP in chiusura (11 task su 12, niente di committato).

## Il problema

La progettazione via MCP (v1/v1.1) vive **fuori dall'app**: serve un abbonamento
Claude o ChatGPT, serve installare un connector, e il valore si consuma nella
chat di qualcun altro. Tre conseguenze:

- chi non ha un abbonamento AI resta fuori del tutto;
- chi ce l'ha deve superare la barriera dell'installazione;
- l'utente esce dalla nostra app, o non ci entra proprio.

Gli obiettivi della variante sono due, distinti: **abbattere la barriera**
(niente abbonamento, niente installazione) e **riportare l'esperienza dentro
l'app**.

## La proposta di partenza: NotebookLM

L'idea iniziale: tutti hanno un account Google, quindi usare NotebookLM come
AI, parlandogli via MCP come fa la skill wm-plan, fino a un «mirroring» dentro
l'app. L'analisi la divide in due ruoli con esiti diversi.

**NotebookLM come cervello: non fattibile.** Due blocchi indipendenti,
ciascuno sufficiente da solo:

1. NotebookLM non è un agente: risponde su sorgenti statiche, non chiama tool.
   Tutta l'architettura poggia sui tool (`route`, `poi_nearby`, `giro_finale`:
   ogni numero viene dal motore, gate, export firmato). Un NotebookLM coi
   «documenti dei sentieri» in pancia è l'AI-senza-tool che lo spike del
   design v1 ha misurato: più di 2 ore di errore su una tappa.
2. Non esiste un'API consumer ufficiale: quella ufficiale è solo Enterprise
   su Google Cloud, in alpha; tutto il resto (compreso l'`nlm` di wm-plan)
   sono client non ufficiali che pilotano un browser o battono l'RPC interna,
   coi token di sessione dell'utente. In wm-plan la direzione è inversa
   (Claude, l'agente, interroga NotebookLM come *sorgente*) e il canale non
   ufficiale gira sull'account del dev: accettabile in casa, non spedibile in
   un'app consumer — sarebbe la stessa mossa già scartata della chat
   sull'abbonamento Claude (vietata da Anthropic, feb 2026), con Google al
   posto di Anthropic, e più fragile.

**NotebookLM come catalogo interrogabile: fattibile, come complemento.**
È l'alternativa B qui sotto: ciò che della proposta sopravvive all'analisi.

## Le alternative

### A. Assistente dentro l'app, inference via API — centra entrambi gli obiettivi

Un modello economico con tool calling vero, chiamato dal gateway: **stessi
tool MCP, stesso metodo a fasi, stessi deliverable firmati** — cambia solo chi
fa girare il cervello e chi paga. L'esperienza completa (vincoli → varianti →
conferma → GPX e scheda) arriva nell'app per tutti gli utenti.

- Il nodo è economico e di responsabilità, non tecnico: vedi «Il modello e il
  costo» e «Questioni aperte».
- La torsione che lo rende sostenibile col business Webmapp: a pagare non è
  Webmapp ma **il committente** (parco, ente) come voce del servizio della
  propria app, con un tetto mensile. A 1-3 centesimi per progettazione il
  costo è trascurabile rispetto al valore percepito.
- Il divieto di Anthropic colpisce le app che consumano *l'abbonamento*
  dell'utente; un'app che paga le **proprie** chiamate API è il modello
  normale e autorizzato.

### B. NotebookLM come catalogo condiviso — complemento a costo zero

Notebook pubblici per area, con dentro le **schede pre-calcolate** dei giri
(i numeri veri del motore: la scheda v1.1 è esattamente il documento adatto).
L'utente li apre col proprio account Google dal canale di condivisione
ufficiale e chatta con le sorgenti: zero inference a carico nostro, barriera
quasi nulla. Noi pubblichiamo con gli strumenti interni (uso nostro: il canale
non ufficiale qui è accettabile, e si rigenera a ogni build del grafo — export
automatico, non manutenzione editoriale).

Limiti chiari: è un **catalogo**, non progettazione — niente giri composti su
misura; rischio di ricombinazioni inventate quando l'utente chiede variazioni
(«accorcialo», «parti dall'altro versante»): da misurare con una prova vera
prima di puntarci. E vive su notebooklm.google.com, non nell'app.

### C. Connector v1 anche su Gemini — costo quasi zero, matura da sola

Lo stesso server MCP pubblicato per l'app Gemini. Oggi **non** abbatte la
barriera: il supporto MCP consumer di Gemini risulta legato ai piani a
pagamento (soprattutto Ultra), in parte riservato ai partner, con restrizioni
di regione e lingua. Da tenere d'occhio: quando Google aprirà, l'artefatto è
già pronto.

### D. Catalogo senza AI — il fondamento comune

Le stesse schede pre-calcolate di B pubblicate come pagine **nostre**,
nell'app e sul web, con filtri (zona, durata, difficoltà, stagione). Zero
costo marginale, zero allucinazioni, dentro l'app da subito; perde la
conversazione. È il gradino su cui B e A poggiano comunque: il corpus di giri
pre-calcolati serve a tutte e tre.

**Lettura d'insieme:** D è il fondamento, B lo rende interrogabile gratis, A è
l'esperienza completa in-app col costo sul committente, C è un'opzione a costo
quasi nullo che matura da sola. Non si escludono: condividono la stessa
pipeline (giri pre-calcolati via `giro_finale`) e gli stessi tool.

## Il modello e il costo (per A)

**Il costo non è più il discrimine.** La fascia economica con tool calling
sta tra $0,04 e $0,15 per milione di token in input (ottobre 2026: gpt-oss
120B ~$0,04; Qwen Flash ~$0,09-0,15; DeepSeek Flash ~$0,15-0,30; Gemini
Flash-Lite ~$0,10; Haiku 5.5 $0,10/$0,50 sotto i 100k di prompt). Una
progettazione completa — una quindicina di scambi coi risultati dei tool nel
context — fa ~150k token cumulativi in input e pochi k in output: **1-3
centesimi a conversazione**, meno col prompt caching. I listini vanno
riverificati sulle pagine ufficiali prima di un contratto, ma l'ordine di
grandezza è solido.

**Open-weight sì, ma via provider.** Self-hosting vuol dire GPU che non
abbiamo e paga solo a volumi che non abbiamo. Il vantaggio vero dell'open-weight
non è il prezzo (pari ai closed economici) ma **l'assenza di lock-in**: lo
stesso modello gira presso un altro provider, o un domani da noi.

**OpenRouter come aggregatore** (scelta proposta): un solo endpoint
OpenAI-compatibile per tutti i candidati — nel benchmark si cambia modello
cambiando una stringa — failover fra provider, pay-per-use. Due attenzioni:
la commissione (~5% sui crediti, accettabile a questi volumi) e **le data
policy dei provider**: vanno selezionati solo provider con politica di
non-addestramento e senza retention (OpenRouter permette di filtrarli),
perché nei prompt passano le posizioni e i vincoli dell'utente — vedi
«Questioni aperte».

**Cosa deve saper fare il modello**, in ordine di importanza:

1. **tool calling affidabile su una catena lunga**: raccogliere vincoli,
   chiamare `route` più volte per le varianti, rispettare il gate, chiamare
   `giro_finale` con gli osmId giusti;
2. **disciplina**: non inventare numeri quando il tool ha risposto, riferire
   `trattiConAltroProfilo` e i fuori-area;
3. **italiano naturale**.

*Non* servono: conoscenza enciclopedica (i fatti vengono dai tool) né visione
(design v1.1: il JSON resta completo, un client testo-only non perde nulla).

## Il benchmark: si misura, non si legge una classifica

Il banco di prova c'è già quasi tutto: i tool MCP, i giri di prova della
cella di Pisa, `mcp-check.mjs` come modello di stile. L'harness fa recitare a
ogni candidato la stessa progettazione — richiesta vaga → vincoli → varianti →
conferma → export — via OpenRouter, e misura:

- **aderenza al metodo**: domande sui vincoli mancanti, gate rispettato,
  niente export senza conferma;
- **correttezza delle chiamate**: parametri di `route` sensati, osmId passati
  a `giro_finale` presi davvero da `poi_nearby`;
- **correttezza dei numeri riferiti**: ogni km/ora/quota citati coincidono con
  la risposta dei tool (il confronto è meccanico: i numeri veri li abbiamo);
- **qualità dell'italiano** (giudizio umano su un campione);
- **costo misurato** per conversazione (token veri, non stime).

Shortlist proposta (4-5): un open-weight piccolo (Qwen), uno medio (DeepSeek),
gpt-oss 120B, e come riferimenti closed Haiku 5.5 e Gemini Flash-Lite.

È lo stesso gesto dello spike che ha fondato la v1: la differenza la fa il
dato misurato, non la supposizione.

## Cosa non cambia

L'architettura v1.1 resta intera: tool, blob firmati, risoluzione dei POI dal
database, gate, scheda. Il principio regge anche qui: **la competenza Webmapp
sta sul dato e sugli strumenti** — cambia solo chi compone, non chi certifica.
Le regole di casa valgono invariate (niente coordinate nei log, `horse_rating`
mai esposto, segreti in variabili d'ambiente).

## Questioni aperte (decisioni da prendere, non dettagli)

1. **Privacy dei prompt**: in-app, posizioni e vincoli dell'utente passano dal
   provider del modello. Serve la stessa serietà del «niente coordinate nei
   log»: provider con no-training e zero retention, informativa aggiornata.
   È il rischio nuovo più serio della variante A.
2. **Responsabilità delle risposte**: con A l'operatore dell'AI diventiamo
   noi, non più l'assistente dell'utente. Disclaimer, tono e limiti del
   metodo vanno decisi come prodotto, non solo come prompt.
3. **Racconto dei luoghi**: in v1 lo fa l'AI dell'utente coi suoi strumenti
   web (wikipedia/wikidata). In-app: o si rinuncia, o si dà al modello un tool
   web — che riapre la questione dei contenuti di terzi lato server, finora
   esclusa per principio.
4. **Chi paga e con che tetto**: committente per app, tetto mensile, cosa
   succede al superamento (coda? degradazione a catalogo D?).
5. **Abuso e rate limiting**: endpoint di inference pagato da noi esposto a
   utenti anonimi — serve throttling per device/sessione.

## Prossimi passi proposti

1. Prova B a costo quasi zero: qualche scheda della cella di Pisa in un
   notebook condiviso, domande da utente vere, misura delle ricombinazioni
   inventate. (Un pomeriggio.)
2. Harness del benchmark per A via OpenRouter sulla shortlist. (Qualche
   giorno, riusa mcp-check e i giri di prova.)
3. Con i numeri in mano: decisione su A (e sulla sua v1, magari dietro
   feature flag in una sola app pilota), e B/D come binario parallelo.

## Fonti

- API NotebookLM solo Enterprise, in alpha:
  <https://horadecodar.com.br/notebooklm-api/> · client non ufficiali:
  <https://docs.rs/nblm-cli> ·
  <https://mcp.directory/blog/notebooklm-mcp-complete-guide-2026>
- MCP consumer su Gemini (piani a pagamento, partner, restrizioni):
  <https://harvv.com/install/gemini> ·
  <https://tallyfy.com/how-to-list-mcp-server-google-gemini/> ·
  <https://tactiq.io/learn/google-gemini-mcp-support>
- Prezzi ottobre 2026 (da riverificare sui listini ufficiali):
  <https://www.developersdigest.tech/blog/frontier-model-api-pricing-june-2026> ·
  <https://www.morphllm.com/llm-api> ·
  <https://llmcalculator.net/cheapest-llm> ·
  <https://klymentiev.com/blog/cheapest-llm-api>

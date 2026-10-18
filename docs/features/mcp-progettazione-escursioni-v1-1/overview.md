# Servizio MCP di progettazione escursioni — v1.1: metodo a fasi, profilo, deliverable componibili

Base: la v1 (docs/features/mcp-progettazione-escursioni/, committata il
2026-10-17) e la pagina di conoscenza
[docs/knowledge/mcp-progettazione-escursioni.md](../../knowledge/mcp-progettazione-escursioni.md).

## Cosa cambia

La progettazione acquista un **metodo prescritto a fasi**, nelle istruzioni del
server: raccolta dei vincoli mancanti → **valutazione di stagione e meteo** →
varianti a confronto → arricchimento del giro scelto → **gate di conferma** →
consegna. I passi scalano con la richiesta (vincoli già dati = niente domande
inutili); il gate prima del deliverable finale non si salta.

Ogni risposta del tool `route` porta il **profilo altimetrico come immagine**
nel risultato del tool (blocco `image` MCP), varianti comprese. Alla conferma,
un **tool di export** produce i deliverable che incorporano la conversazione:
il **GPX arricchito** coi POI scelti come waypoint nominati, e la **scheda
stampabile** (`/g/scheda`), una pagina HTML con mappa, profilo, numeri e
waypoint, che l'utente salva in PDF dal browser.

## Perché

La v1, collaudata su tre prove reali, consegna numeri esatti e racconto — ma
tutto in un fiato: nessun momento in cui l'utente *decide* il giro, nessun
visual che renda confrontabili le varianti, e il GPX porta waypoint generici
(«Punto 1») che in cammino non dicono nulla. Soprattutto: il meteo e la
stagione, che in montagna cambiano l'itinerario più di ogni altra cosa, oggi
non entrano nella progettazione se non è l'utente a chiederli.

Il principio che governa tutte le scelte qui, e che vale oltre questo ciclo:
**la competenza Webmapp sta sul dato e sugli strumenti; comporre strumenti e
dati è delegato all'utente tramite la sua AI.** Da qui discende che non
generiamo testi, non facciamo da tramite per fonti che il client raggiunge da
solo, non archiviamo prosa, e firmiamo solo ciò che calcoliamo noi.

## Requisiti

### Metodo a fasi

- [ ] **Istruzioni del server riscritte come flusso con gate**: (1) raccogli i
  vincoli mancanti — zona, tempo a disposizione, difficoltà, interessi e
  **data**, una domanda per volta, saltando ciò che l'utente ha già detto;
  (2) **valuta stagione e meteo** (sotto); (3) proponi 2-3 varianti calcolate,
  con numeri e profilo a confronto; (4) arricchisci il giro scelto (POI,
  racconto wiki lato client); (5) **gate**: chiedi conferma esplicita;
  (6) solo dopo il sì, chiama il tool di export. I passi si saltano quando
  l'informazione c'è già, il gate no.
- [ ] **Valutazione di stagione e meteo come passo del metodo, non come
  risposta a una domanda**: la previsione non si consulta perché l'utente la
  chiede, ma perché è un ingresso della progettazione, e **cambia
  l'itinerario** (temporale nella finestra di passaggio in cresta → variante
  che scollina prima o che passa vicino a un riparo; caldo d'agosto → la
  sorgente diventa una tappa). Gli strumenti per adattare esistono già:
  ripari, rifugi e sorgenti sono nella tabella `poi`.
- [ ] **La data si chiede, non si impone**: è uno dei vincoli della fase 1, non
  un blocco. Se arriva, si valuta la previsione; se non arriva, **la parte
  stagionale funziona comunque** sulla data di oggi (luce, caldo, neve,
  periodo), ragionando sui giorni a venire — che è quello che fa chi progetta
  davvero — e resta l'offerta: «dimmi il giorno e guardo anche la previsione».
- [ ] **Orizzonte della previsione dichiarato**: oltre i giorni in cui una
  previsione ha senso, il metodo lo dice e ripiega sulla stagione, mai
  inventa una previsione.
- [ ] Il **tool dei punti d'interrogazione** per il meteo (dove e a che ora
  chiedere la previsione, calcolato dalla nostra geometria e dai tempi DIN)
  **non è di questo ciclo**: in v1.1 il metodo è testo nelle istruzioni e i
  punti se li sceglie l'AI. Senza il tool il metodo funziona, col tool
  diventerà preciso (v1.2).

### Profilo altimetrico nel risultato del tool

- [ ] **Immagine in ogni risposta di `route`**, varianti comprese: blocco
  `image` MCP (base64, `image/png`) accanto al JSON compatto, generata dal
  server dalla geometria a piena risoluzione (non dal campione a 25 punti).
- [ ] **Nessuna dipendenza nuova**: l'encoder PNG si scrive con `node:zlib`
  (firma + IHDR + IDAT + IEND, ~40 righe) — verificato con uno spike:
  640×200 pixel, **1,7 KB** sul giro di Calci. `pngjs` non serve.
- [ ] **Linguaggio visivo condiviso con la preview**: la logica pura di scala
  e tacche di `drawProfile` (`preview/preview.js:567` — quote arrotondate a
  passi di 50 m, funzioni `x()`/`y()`, posizione delle tre linee di quota e
  delle tre etichette di distanza, palette) si estrae in un modulo condiviso,
  importato dal browser e dal server. Il disegno resta diverso (Canvas 2D nel
  browser, buffer di pixel sul server): `node-canvas` richiederebbe una
  compilazione nativa, un browser a runtime sarebbe troppo lento per un
  disegno a ogni chiamata.
- [ ] **Etichette sul grafico** come nella preview (quote in metri, distanze
  in km), rese con un **font bitmap minimo** (cifre, punto, «m», «km»):
  un'immagine viaggia da sola — screenshot, scheda stampabile, chat riletta
  settimane dopo — e deve portarsi dietro la propria scala. Ordine dei
  lavori: prima modulo di scala e sagoma funzionante, **poi** il font come
  ultimo passo dello stesso task, così fermarsi resta possibile.

### Deliverable alla conferma

- [ ] **Tool di export** (es. `giro_finale`): riceve punti, profilo e la lista
  dei POI scelti **come identificatori** — `[{osmId, nota?}]`, mai coordinate
  o nomi. Il server risolve nome, posizione, tipo e quota **dalla tabella
  `poi`**: i fatti non passano mai dalle mani del modello. L'unica cosa che
  il modello scrive è la `nota`, dichiaratamente sua, **di una riga**
  (lunghezza massima e niente a capo, oltre all'escaping già esistente).
  Restituisce i link al GPX arricchito e alla scheda.
- [ ] **Blob firmato esteso** col campo dei POI (osmId + nota): resta piccolo
  perché non porta coordinate. Tetto esplicito al numero di POI, con errore
  chiaro oltre il limite, e la dimensione del blob asserita in un test.
- [ ] **`toGpx` scrive waypoint nominati**: `<wpt>` con `<name>` e `<ele>` dal
  database e `<desc>` con la nota; i punti del giro senza POI restano
  «Punto N». **Il racconto lungo non entra nel GPX**: i navigatori mostrano
  male i testi lunghi, e il contesto esteso resta in chat.
- [ ] **Scheda stampabile** `/g/scheda?t=<blob>`: pagina HTML gemella del GPX
  — stesso blob, stessi fatti — con mappa del giro, profilo, tabella dei
  numeri, tappe con i tempi e waypoint con le loro note. Si salva in PDF dal
  browser: **nessuna libreria PDF** nel gateway, layout in CSS, e il profilo
  lo disegna **lo stesso `drawProfile` della preview** (riuso totale, da
  browser a browser). Il racconto lungo resta fuori: non entra in una query
  string, e farcelo entrare richiederebbe stato sul server.
- [ ] **Retrocompatibilità**: un blob senza POI si comporta come oggi; i link
  v1 già consegnati restano validi.

### Trasversali

- [ ] **Il gate è best-effort, e va dichiarato tale**: protegge i deliverable
  che incorporano la conversazione (GPX arricchito e scheda), non il
  `linkGpx` nudo, che resta immediato come in v1 perché è il dato grezzo che
  il motore darebbe comunque. L'unica mitigazione strutturale è che l'export
  esiste solo attraverso una chiamata esplicita al tool, visibile in chat e
  registrata nei log.
- [ ] **Ogni dato dichiara la propria fonte**: i POI «OpenStreetMap, dati
  del \<data\>», e la stessa regola varrà per le fonti esterne della v1.2.
- [ ] Regole di casa invariate: niente coordinate/blob nei log,
  `horse_rating` mai esposto, segreti solo in variabili d'ambiente.
- [ ] **Accettazione**: (1) `mcp-check.mjs` esteso — il PNG del giro campione
  è un PNG valido, delle dimensioni attese, con pixel deterministici in
  posizioni note; l'export con osmId di prova produce un GPX coi `<wpt>`
  nominati risolti dal database; la scheda risponde e contiene i numeri di
  `/v1`; il blob esteso decodifica e, manomesso, viene rifiutato; il tetto
  sui POI dà errore chiaro. (2) Checklist manuale estesa: richiesta vaga →
  domande; data data → valutazione meteo che **cambia** la proposta; varianti
  col profilo a confronto; conferma → GPX arricchito e scheda; richiesta
  secca → niente domande inutili ma gate comunque prima dell'export.

## Rischi

Dalla challenge del 2026-10-18, con le mitigazioni decise:

- **Il modello trascrive i dati dei POI nel deliverable firmato** (era la
  criticità più grave: la firma HMAC certificherebbe un'allucinazione):
  risolto alla radice — l'export riceve `osmId`, non dati, e i fatti li
  risolve il server. Il modello scrive solo la nota, che se imprecisa resta
  un consiglio discutibile, non una posizione sbagliata.
- **Il profilo costava più del previsto** (`pngjs` codifica, non disegna):
  risolto dallo spike — encoder con `node:zlib`, nessuna dipendenza, 1,7 KB
  misurati; le etichette con un font bitmap minimo, in coda al task.
- **Il gate è aggirabile** (linkGpx nudo sempre disponibile; client che
  ignorano le istruzioni del server): dichiarato best-effort, vedi requisiti.
  Degradazione nota: su un client che ignora le istruzioni la v1.1 funziona
  come la v1 più il profilo — meno guidata, non rotta. Su Claude Code le
  istruzioni sono seguite (misurato il 2026-10-17: il comportamento è
  cambiato appena riscritte).
- **I POI nel blob invecchiano rispetto al grafo**: `/g/gpx` e `/g/scheda`
  ricalcolano il percorso, ma i waypoint restano dove erano. La scheda può
  mostrare il banner «dati cambiati» come la preview; il GPX no, è un file
  scaricato. Mitigazione: il data stamp è già nel blob e nel GPX, e i
  waypoint sono POI (punti fissi sul territorio), non punti del tracciato.
- **Peso delle immagini nel context**: ridimensionato dalla misura (1,7 KB a
  variante); il JSON compatto resta completo, quindi un client che non mostra
  immagini non perde informazione.

## Out of scope

- **Tool che restituiscono i punti d'interrogazione del meteo** (v1.2),
  insieme al resto del set di strumenti: ristoro con gli orari dichiarati
  solo quando ci sono — nella cella di Pisa ci sono 4.640 punti di ristoro
  nei dati OSM ma solo il 15% ha gli orari, e un tool che tace è meglio di
  un tool che sbaglia.
- **Archiviazione del testo georeferenziato prodotto dalle AI degli utenti**:
  escluso per coerenza con l'architettura, non per prudenza — il testo
  derivato invecchia e andrebbe mantenuto, ricreando esattamente la
  manutenzione che si voleva eliminare; in più eredita i vincoli di licenza
  delle fonti da cui nasce.
- Libreria PDF nel gateway (la scheda si stampa dal browser); mappa statica
  PNG lato server; racconto lungo dentro GPX o scheda.
- Sportello, auth, OAuth, ChatGPT: fase «sul server» del design v1.
- Telemetria; tool «percorso lungo il sentiero X»; distanza dei POI dal
  tracciato vero (oggi è dal punto campionato — resta nei follow-up v1).
- Contenuti wiki lato server (invariato: solo identificatori).

## Moduli toccati

Tutto nel repo wm-routing (feature custom, nessun submodule):

- `gateway/src/mcp/server.js` — istruzioni a fasi; tool di export; blocco
  immagine nella risposta di `route`.
- `gateway/src/mcp/profilo.js` — nuovo: encoder PNG con `node:zlib`, disegno
  per colonne, font bitmap minimo.
- `preview/profilo-scala.js` — nuovo: logica pura di scala e tacche,
  condivisa fra preview, scheda e server.
- `preview/preview.js` — `drawProfile` usa il modulo condiviso.
- `gateway/src/mcp/link.js` — campo opzionale dei POI nel blob, con tetto.
- `gateway/src/mcp/gpx.js` — waypoint nominati con `<name>`, `<ele>`, `<desc>`.
- `gateway/src/mcp/poi.js` — risoluzione per `osmId`.
- `gateway/src/mcp/g-route.js` — rotta `/g/scheda`, POI del blob a `toGpx`.
- `preview/scheda.html` + CSS di stampa — nuovo: la pagina stampabile.
- `gateway/test/`, `gateway/scripts/mcp-check.mjs`,
  `docs/howto/collaudo-connector-mcp.md` — test e accettazione estesi.

# v1.1 del servizio MCP — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** profilo altimetrico come immagine nelle risposte del tool, deliverable che incorporano la conversazione (GPX arricchito e scheda stampabile) risolti dal database a partire dagli osmid, e un metodo a fasi con gate nelle istruzioni del server.

**Architecture:** la logica di scala del profilo diventa un modulo puro condiviso fra preview, scheda e server; il server disegna il PNG riempiendo una colonna per volta e lo impacchetta con `node:zlib`, senza dipendenze nuove. I POI scelti viaggiano nel blob firmato **come identificatori**: nome, posizione e quota li risolve il server dalla tabella `poi`, così la firma non certifica mai una trascrizione del modello.

**Tech Stack:** Node 20 (ESM), express 5, better-sqlite3, `@modelcontextprotocol/sdk` 1.32, vitest + supertest, `node:zlib` (built-in), preview in OpenLayers come script classico.

**Spec:** `docs/features/mcp-progettazione-escursioni-v1-1/overview.md` (requisiti), con la v1 in `docs/features/mcp-progettazione-escursioni/` e `docs/knowledge/mcp-progettazione-escursioni.md`.

## Global Constraints

- **Nessuna dipendenza nuova**: l'encoder PNG si scrive con `node:zlib`; `pngjs` e le librerie grafiche native sono escluse.
- **Il modello non fornisce mai dati**: l'export riceve `osmId`, mai coordinate, nomi o quote. L'unico testo suo è la `nota`.
- **Nota**: una riga, massimo 80 caratteri, nessun a capo, escaping XML con `esc` esistente.
- **Tetto POI nel blob**: massimo 20, oltre il quale errore esplicito. (Era 30 nella
  prima stesura: misurato in Task 6, 30 POI con note piene danno un blob di 4514
  caratteri, sopra il limite che tiene il link incollabile. Con 20 il caso peggiore
  resta sotto i 4000.)
- Niente coordinate, blob o token nei log (`gateway/src/log.js`); `horse_rating` mai esposto; segreti solo in variabili d'ambiente.
- Retrocompatibilità: un blob senza POI si comporta come in v1; i link già consegnati restano validi.
- Documentazione e commenti in italiano, identificatori in inglese.
- I passi di commit sono **istruzioni per il dev**: nessun `git commit`/`add`/`push`/branch automatico.
- Ambiente: ricreare il container **senza** `source tools/bbox.sh` nella stessa shell (la variabile di shell vince sullo `.env` e rompe il bbox della cella).

## Review Focus

1. Percorso quasi piatto (dislivello nullo): la scala divide per l'escursione di quota → profilo comunque disegnato, mai divisione per zero. (Test in Task 1.)
2. Geometria con quote mancanti o a zero: il grafico non deve inventare rilievo né fallire. (Test in Task 3.)
3. `osmId` che non esiste più nella tabella (grafo rigenerato): l'export dice **quale** manca, non lo salta in silenzio. (Test in Task 5.)
4. Nota con a capo, caratteri XML o oltre il limite: sanificata prima di entrare nel GPX, mai un file rotto. (Test in Task 6.)
5. Scheda e GPX aperti con un blob v1 senza POI: funzionano con i waypoint generici di prima. (Test in Task 7 e Task 9.)

---

## Blocco 1 — profilo altimetrico

### Task 1: Modulo di scala condiviso

**Files:**
- Create: `preview/profilo-scala.js`
- Modify: `preview/preview.js:557-589` (usa il modulo), `preview/index.html:302`
- Test: `gateway/test/profilo-scala.test.js`

**Interfaces:**
- Produces: `cumulative(coords) -> number[]` (distanze cumulate in metri, invariata rispetto a `preview.js:557`); `scalaProfilo({coords, width, height, left, bottom, top}) -> {lo, hi, maxD, x(d), y(e), tacche: {quote: [{valore, etichetta}], distanze: [{valore, etichetta}]}, colori: {griglia, testo}}`. Regole da conservare dalla preview: `lo` arrotondato per difetto e `hi` per eccesso a multipli di 50 m con `hi >= lo + 50`; tre tacche di quota (`lo`, media, `hi`) con etichetta `"<n> m"`; tre di distanza (0, metà, totale) con etichetta `"<n.n> km"`; `colori.griglia = '#d8dde2'`, `colori.testo = '#5f6b76'`.

- [ ] **Step 1: scrivi i test che falliscono** in `gateway/test/profilo-scala.test.js`:
  - `cumulative` su due punti a 0.01° di longitudine a 44° di latitudine dà ~800 m (tolleranza 5%);
  - quote 31..870 → `lo === 0`, `hi === 900`; etichette di quota `['0 m', '450 m', '900 m']`;
  - percorso piatto (tutte le quote a 100) → `hi - lo === 50`, nessun `NaN` in `y(100)`;
  - `x(0) === left` e `x(maxD) === width - 6`; `y(lo) === height - bottom`;
  - etichette di distanza su 20560 m: `['0.0 km', '10.3 km', '20.6 km']`.
- [ ] **Step 2: esegui** `cd gateway && npx vitest run test/profilo-scala.test.js` — atteso: FAIL (modulo inesistente).
- [ ] **Step 3: implementa `preview/profilo-scala.js`** come modulo ESM puro (nessun riferimento a `window` o al DOM: lo importa anche il server).
- [ ] **Step 4: esegui** — atteso: PASS.
- [ ] **Step 5: fai usare il modulo alla preview.** In `preview/index.html`, prima dello script della preview:

```html
<script type="module">
  import * as profiloScala from './profilo-scala.js';
  window.WmProfiloScala = profiloScala;
</script>
<script defer src="preview.js"></script>
```

  (modulo inline e script classico `defer` eseguono entrambi dopo il parsing, in ordine di documento: il globale esiste prima della preview). In `preview.js` togli `cumulative` e le righe di scala di `drawProfile`, e usa `WmProfiloScala`. Il disegno resta quello di oggi: la preview traccia linee colorate per criterio, il server riempirà una sagoma — **condividiamo scala, tacche ed etichette, non il tratto**.
- [ ] **Step 6: verifica la preview** con `cd gateway && node scripts/preview-check.mjs` e `node scripts/preview-ux-check.mjs` — atteso: entrambi `ok`.
- [ ] **Step 7: commit (istruzione per il dev):** `feat(mcp-progettazione-escursioni): modulo di scala del profilo condiviso con la preview`

### Task 2: Encoder PNG senza dipendenze

**Files:**
- Create: `gateway/src/mcp/png.js`
- Test: `gateway/test/png.test.js`

**Interfaces:**
- Produces: `encodePng(width, height, rgb) -> Buffer` — `rgb` è un `Buffer` di `width*height*3` byte; produce un PNG a 8 bit, colorType 2 (RGB), filtro `none` su ogni scanline, chunk IHDR/IDAT/IEND con CRC-32, compressione `deflateSync` di `node:zlib`.

- [ ] **Step 1: test che falliscono**: l'output inizia con la firma `89 50 4E 47 0D 0A 1A 0A`; contiene i tipi di chunk `IHDR`, `IDAT`, `IEND` in quest'ordine; l'IHDR dichiara larghezza e altezza passate, bit depth 8 e colorType 2; due chiamate con lo stesso input danno byte identici (deterministico); un'immagine 2×1 di due colori noti si decomprime (`inflateSync` dell'IDAT) in `00 r g b r g b`.
- [ ] **Step 2: esegui** `npx vitest run test/png.test.js` — FAIL.
- [ ] **Step 3: implementa `png.js`.** La tabella CRC-32 e l'ordine dei chunk sono gli unici dettagli non derivabili dalla firma: la tabella si genera una volta con il polinomio `0xedb88320`, ogni chunk è `lunghezza(4) + tipo(4) + dati + crc(4)` dove il CRC copre tipo e dati.
- [ ] **Step 4: esegui** — PASS.
- [ ] **Step 5: commit:** `feat(mcp-progettazione-escursioni): encoder png con node:zlib, nessuna dipendenza`

### Task 3: Disegno del profilo, con etichette

**Files:**
- Create: `gateway/src/mcp/profilo.js`
- Test: `gateway/test/profilo.test.js`

**Interfaces:**
- Consumes: Task 1 (`cumulative`, `scalaProfilo` da `../../../preview/profilo-scala.js`), Task 2 (`encodePng`).
- Produces: `profiloPng({coords, tappeIdx, width = 640, height = 200}) -> Buffer`. Disegno: sfondo `#f8f9fa`, sagoma riempita dal basso fino alla quota di ogni colonna (`#7a8f5c`) con bordo superiore `#465534`, linee di griglia ed etichette nei colori del modulo condiviso, tappe come segmento verticale `#d65a3c` di 14 pixel sopra il profilo.

- [ ] **Step 1: test che falliscono** (su una geometria sintetica di 200 punti che sale da 100 a 600 m e torna a 100, con `tappeIdx` a inizio, metà e fine):
  - il risultato è un PNG valido (firma) di 640×200 letti dall'IHDR;
  - deterministico: due chiamate identiche;
  - il pixel in basso a sinistra appartiene alla sagoma e quello in alto a destra è sfondo;
  - una colonna in corrispondenza di una tappa contiene il colore della tappa;
  - **quote tutte a zero**: ritorna comunque un PNG valido delle dimensioni attese (nessuna eccezione, nessun `NaN`);
  - taglia sotto i 20 KB sulla geometria sintetica.
- [ ] **Step 2: esegui** `npx vitest run test/profilo.test.js` — FAIL.
- [ ] **Step 3: implementa la sagoma** (senza etichette): per ogni colonna `x`, distanza `d = x/(W-1) * maxD`, quota interpolata fra i due punti della geometria che la contengono, riempimento dal basso.
- [ ] **Step 4: esegui** — i test sulle etichette non ci sono ancora, gli altri PASS.
- [ ] **Step 5: aggiungi il test delle etichette**: in una banda di 10 pixel attorno a `y(hi)` esistono pixel del colore del testo nella zona di sinistra (dove va `"900 m"`).
- [ ] **Step 6: esegui** — FAIL su quel test.
- [ ] **Step 7: implementa il font bitmap minimo** in `profilo.js`: glifi 5×7 per `0123456789.` più `m`, `k` e lo spazio, come maschere di bit; `disegnaTesto(px, W, x, y, testo, colore)` le stampa. Nessun glifo per caratteri fuori elenco: si saltano.
- [ ] **Step 8: esegui** — PASS, poi `npm test` intero — PASS.
- [ ] **Step 9: guarda l'immagine.** Genera un profilo del giro di Calci contro il gateway locale, salvalo in un file temporaneo **fuori dal repo** e aprilo: è l'unico controllo che i test non fanno.
- [ ] **Step 10: commit:** `feat(mcp-progettazione-escursioni): profilo altimetrico disegnato dal server`

### Task 4: Il profilo entra nella risposta di `route`

**Files:**
- Modify: `gateway/src/mcp/server.js` (il wrapper `logged` e la registrazione di `route`)
- Test: `gateway/test/mcp-server.test.js` (casi nuovi)

**Interfaces:**
- Consumes: Task 3 (`profiloPng`).
- Produces: il risultato del tool `route` contiene due blocchi — `{type: 'text', text: <JSON compatto>}` e `{type: 'image', data: <base64>, mimeType: 'image/png'}`. Il wrapper `logged` accetta che la funzione restituisca immagini senza perdere la riga di log.

- [ ] **Step 1: test che falliscono**: la chiamata a `route` con la fixture esistente produce un `content` di due elementi, il secondo con `type: 'image'` e `mimeType: 'image/png'`, e `data` che decodificato in base64 inizia con la firma PNG; una risposta d'errore (meno di due punti) resta **senza** immagine; se `profiloPng` lancia, la risposta è comunque il testo col JSON (l'immagine è un di più, non un requisito della risposta).
- [ ] **Step 2: esegui** `npx vitest run test/mcp-server.test.js` — FAIL.
- [ ] **Step 3: implementa.** `profiloPng` riceve la geometria **a piena risoluzione** dalla risposta di `/v1`, non il campione di `compactRoute`.
- [ ] **Step 4: esegui** — PASS, poi `npm test` — PASS.
- [ ] **Step 5: commit:** `feat(mcp-progettazione-escursioni): il profilo arriva nel risultato del tool route`

## Blocco 2 — deliverable risolti dal database

### Task 5: Risoluzione dei POI per osmId

**Files:**
- Modify: `gateway/src/mcp/poi.js`
- Test: `gateway/test/mcp-poi.test.js` (casi nuovi)

**Interfaces:**
- Produces: `makeResolvePoi({waysDbPath}) -> (osmIds) => {trovati: [{osmId, name, kind, ele, lon, lat}], mancanti: number[]}`, nell'ordine in cui gli id sono stati passati. Tabella assente o file mancante → `{trovati: [], mancanti: <tutti>}`.

- [ ] **Step 1: test che falliscono** (fixture sqlite come nei test esistenti): due id esistenti risolti nell'ordine passato, con nome e quota dal database; **un id inesistente finisce in `mancanti`**, gli altri si risolvono lo stesso; database senza tabella `poi` → tutti mancanti, nessuna eccezione; `horse` mai presente nell'output serializzato.
- [ ] **Step 2: esegui** `npx vitest run test/mcp-poi.test.js` — FAIL.
- [ ] **Step 3: implementa** riusando l'apertura in sola lettura già presente nel file.
- [ ] **Step 4: esegui** — PASS.
- [ ] **Step 5: commit:** `feat(mcp-progettazione-escursioni): risoluzione dei poi per osmid`

### Task 6: Blob firmato esteso con i POI

**Files:**
- Modify: `gateway/src/mcp/link.js`
- Test: `gateway/test/mcp-link.test.js` (casi nuovi)

**Interfaces:**
- Produces: `encodeLink({points, profile, stamp, poi}, key)` dove `poi` è opzionale, `[{osmId, nota?}]`, scritto nel payload con chiavi compatte (`i` per l'osmid, `n` per la nota) sotto il campo `poi`; `decodeLink` lo restituisce come `[{osmId, nota}]` e **`[]` quando il campo manca**. Vincoli: oltre 30 POI lancia `LinkError('troppi_poi')`; ogni nota viene normalizzata prima di entrare — a capo e tabulazioni diventano spazi, si taglia a 80 caratteri.

- [ ] **Step 1: test che falliscono**: round-trip con 2 POI (osmid e note identici); blob **senza** `poi` → `decodeLink` dà `[]` (retrocompatibilità); 31 POI → `LinkError` con `stato: 'troppi_poi'`; una nota con `"\n"` e 200 caratteri torna su una riga sola di 80; un blob con POI manomesso in un carattere → `firma_non_valida`; **la lunghezza del blob con 30 POI e note piene resta sotto i 4000 caratteri** (il link deve restare incollabile).
- [ ] **Step 2: esegui** `npx vitest run test/mcp-link.test.js` — FAIL.
- [ ] **Step 3: implementa.**
- [ ] **Step 4: esegui** — PASS.
- [ ] **Step 5: commit:** `feat(mcp-progettazione-escursioni): poi come identificatori nel blob firmato`

### Task 7: Waypoint nominati nel GPX

**Files:**
- Modify: `gateway/src/mcp/gpx.js`, `gateway/src/mcp/g-route.js` (la rotta `/gpx` risolve i POI del blob)
- Test: `gateway/test/mcp-gpx.test.js`, `gateway/test/g-route.test.js` (casi nuovi)

**Interfaces:**
- Consumes: Task 5 (`makeResolvePoi`), Task 6 (il campo `poi` del blob).
- Produces: `toGpx({geometry, points, profile, stamp, poi})` con `poi` opzionale `[{name, lon, lat, ele, nota}]`: ogni POI diventa un `<wpt>` con `<name>`, `<ele>` quando la quota è nota e `<desc>` quando c'è la nota; i punti del giro restano `Punto N` come oggi. `makeGRouter` accetta `resolvePoi` e lo usa in `/g/gpx`.

- [ ] **Step 1: test che falliscono**: con due POI il GPX ha due `<wpt>` in più, con il nome del database e la nota in `<desc>`; una nota con `&` e `<` esce con l'escaping; un POI senza quota non scrive `<ele>` vuoto; **senza `poi` il GPX è identico a quello di oggi** (retrocompatibilità); in `g-route.test.js`: un blob con osmid risolvibili produce il GPX coi nomi, un blob v1 senza POI produce quello di prima.
- [ ] **Step 2: esegui** `npx vitest run test/mcp-gpx.test.js test/g-route.test.js` — FAIL.
- [ ] **Step 3: implementa.**
- [ ] **Step 4: esegui** — PASS, poi `npm test` — PASS.
- [ ] **Step 5: commit:** `feat(mcp-progettazione-escursioni): waypoint nominati nel gpx, risolti dal database`

### Task 8: Tool di export `giro_finale`

**Files:**
- Modify: `gateway/src/mcp/server.js`
- Test: `gateway/test/mcp-server.test.js` (casi nuovi)

**Interfaces:**
- Consumes: Task 5, Task 6.
- Produces: tool MCP `giro_finale` — input `{points, profile, poi?: [{osmId: number, nota?: string}]}` — che compone il blob esteso e restituisce `{linkGpx, linkScheda, poiRisolti: [{osmId, name}], poiMancanti: number[]}`. Nella descrizione del tool: «i punti di interesse si passano **come osmId** presi da `poi_nearby`; nome, posizione e quota li risolve il servizio. La nota è una riga tua». Se tutti gli osmId mancano → `{stato: 'poi_non_trovati', poiMancanti}`.

- [ ] **Step 1: test che falliscono**: con due osmid validi restituisce i due link e `poiRisolti` coi nomi dal database; **un osmid inesistente compare in `poiMancanti`** e gli altri passano lo stesso; 21 POI → `{stato: 'troppi_poi'}` senza eccezione; i link sono decodificabili e contengono i POI; la chiamata produce la sua riga di log con `tool: 'giro_finale'`.
- [ ] **Step 2: esegui** — FAIL. **Step 3: implementa.** **Step 4: esegui** — PASS, poi `npm test` — PASS.
- [ ] **Step 5: commit:** `feat(mcp-progettazione-escursioni): tool giro_finale, deliverable dopo la conferma`

## Blocco 3 — scheda stampabile

### Task 9: Rotta `/g/scheda` e contenuto della pagina

**Files:**
- Create: `preview/scheda.html`, `preview/scheda.js`, `preview/scheda.css`
- Modify: `gateway/src/mcp/g-route.js` (rotta `/scheda`)
- Test: `gateway/test/g-route.test.js` (casi nuovi)

**Interfaces:**
- Consumes: Task 5, Task 6; la stessa `compute` già passata a `makeGRouter`.
- Produces: `GET /g/scheda?t=<blob>` serve `scheda.html`; la pagina chiede i dati a `GET /g/scheda.json?t=<blob>`, che risponde `{profilo, distanzaKm, salitaM, discesaM, oreDIN33466, quotaMinMaxM, tappe, sentieri, geometry, stamp, stampCorrente, poi: [{name, kind, ele, lonLat, nota}]}`. Firma rotta o punti fuori area: stesse pagine di errore di `/g/`.

- [ ] **Step 1: test che falliscono** in `g-route.test.js`: `/g/scheda` con blob valido risponde 200 HTML; `/g/scheda.json` con blob valido contiene i totali del percorso e i POI risolti coi nomi del database; **un blob v1 senza POI dà `poi: []` e il resto invariato**; blob manomesso → 400 con la pagina «alterato»; punti fuori area → 400 con l'area dichiarata.
- [ ] **Step 2: esegui** `npx vitest run test/g-route.test.js` — FAIL.
- [ ] **Step 3: implementa la rotta** e `scheda.html` con: intestazione col profilo e la data dei dati, tabella dei numeri, elenco delle tappe con km e tempo, elenco dei waypoint con nome, quota e nota, e in fondo l'avvertenza del servizio (`WARNING` di `route.js`) più la fonte dei POI: «Punti di interesse: OpenStreetMap, dati del \<stamp\>».
- [ ] **Step 4: scrivi `scheda.css`** con le regole di stampa (`@media print`: nessun margine superfluo, niente elementi interattivi, interruzioni di pagina sensate).
- [ ] **Step 5: esegui** — PASS.
- [ ] **Step 6: commit:** `feat(mcp-progettazione-escursioni): scheda stampabile del giro`

### Task 10: Mappa, profilo e banner nella scheda

**Files:**
- Modify: `preview/scheda.js`, `preview/scheda.html`
- Test: `gateway/scripts/scheda-check.mjs` (nuovo, stile `preview-check.mjs`)

**Interfaces:**
- Consumes: Task 1 (`profilo-scala.js`), Task 9 (`/g/scheda.json`).
- Produces: la scheda disegna la mappa del giro (OpenLayers e `olms` come la preview, stessa sorgente di stile) e il profilo altimetrico con **lo stesso codice di disegno della preview**, estratto in una funzione riusabile; banner «I dati sono cambiati da quando questo giro è stato progettato: ricontrolla tempi e difficoltà.» quando `stamp` e `stampCorrente` differiscono.

- [ ] **Step 1: scrivi `scheda-check.mjs`** (Playwright, come `preview-check.mjs`): apre `/g/scheda?t=<blob di prova>`, attende mappa e profilo, verifica che compaiano i numeri attesi, che il canvas del profilo non sia vuoto, che senza divergenza di stamp il banner non ci sia e con uno stamp finto ci sia; esce 0/1.
- [ ] **Step 2: esegui** `cd gateway && node scripts/scheda-check.mjs` — FAIL.
- [ ] **Step 3: estrai il disegno del profilo** da `preview.js` in una funzione riusabile e usala da entrambe le pagine; implementa mappa e banner nella scheda.
- [ ] **Step 4: esegui** — PASS; poi `node scripts/preview-check.mjs` e `node scripts/preview-ux-check.mjs` — PASS (la preview non è regredita).
- [ ] **Step 5: guarda la scheda e stampala in PDF** dal browser: impaginazione e leggibilità sono l'unico controllo che i test non fanno.
- [ ] **Step 6: commit:** `feat(mcp-progettazione-escursioni): mappa, profilo e banner nella scheda`

## Blocco 4 — metodo e accettazione

### Task 11: Istruzioni del server come metodo a fasi

**Files:**
- Modify: `gateway/src/mcp/server.js` (`INSTRUCTIONS`)
- Test: `gateway/test/mcp-server.test.js` (casi nuovi)

**Interfaces:**
- Consumes: i tool esistenti (`route`, `poi_nearby`, `giro_finale`).
- Produces: `INSTRUCTIONS` riscritte con le sei fasi dell'overview. Contenuti obbligatori: i passi si saltano quando l'informazione c'è già, **il gate no**; la data si chiede fra i vincoli e non si impone, e senza data vale comunque la stagione dalla data di oggi; la previsione si valuta **prima** di proporre le varianti e **cambia** la proposta (riparo o sorgente da `poi_nearby`); oltre l'orizzonte utile la previsione non si inventa, si ripiega sulla stagione; i POI si passano a `giro_finale` **come osmId**; la disciplina della v1 (numeri dai tool, link intatti, fuori area dichiarato, `trattiConAltroProfilo` riferito) resta.

- [ ] **Step 1: test che falliscono**: `INSTRUCTIONS` nomina tutti e tre i tool (`route`, `poi_nearby`, `giro_finale`); le sei fasi compaiono numerate e in ordine; la parola «conferma» compare dopo la fase di arricchimento e prima di quella di export; compare «osmId» nella parte che descrive come si passano i POI.
- [ ] **Step 2: esegui** — FAIL. **Step 3: scrivi le istruzioni.** **Step 4: esegui** — PASS.
- [ ] **Step 5: prova vera dal vivo**: dalla sessione registrata in Claude Code, chiedi un giro senza dare la data e verifica che il modello chieda i vincoli, proponga varianti col profilo, chieda conferma e solo dopo chiami `giro_finale`. Esito riportato al dev.
- [ ] **Step 6: commit:** `feat(mcp-progettazione-escursioni): metodo a fasi con gate nelle istruzioni del server`

### Task 12: Accettazione estesa

**Files:**
- Modify: `gateway/scripts/mcp-check.mjs`, `docs/howto/collaudo-connector-mcp.md`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: tutti i task precedenti.
- Produces: `mcp-check.mjs` verifica anche, sulla richiesta campione: il blocco immagine è un PNG valido 640×200; `giro_finale` con un osmid vero della cella (il Monte Serra) produce un GPX con quel `<wpt>` nominato; `/g/scheda.json` risponde coi numeri di `/v1`; un blob con POI manomesso dà 400; 21 POI danno `troppi_poi`.

- [ ] **Step 1: estendi `mcp-check.mjs`** e **Step 2: esegui** `cd gateway && node scripts/mcp-check.mjs` — tutte le righe `ok`.
- [ ] **Step 3: estendi la checklist manuale** in `docs/howto/collaudo-connector-mcp.md` col flusso: richiesta vaga → domande sui vincoli; data data → la valutazione meteo **cambia** la proposta; varianti col profilo a confronto; conferma → GPX arricchito e scheda; richiesta secca → niente domande inutili ma gate comunque prima dell'export.
- [ ] **Step 4: aggiorna** la riga dei comandi in `README.md` e `CLAUDE.md` con `scheda-check.mjs`.
- [ ] **Step 5: esegui** `bash tools/log-check.sh` — `ok` (le rotte nuove non devono loggare blob né coordinate).
- [ ] **Step 6: commit:** `feat(mcp-progettazione-escursioni): accettazione e collaudo estesi alla v1.1`

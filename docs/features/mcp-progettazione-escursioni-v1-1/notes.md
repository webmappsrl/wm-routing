# Notes — v1.1 del servizio MCP di progettazione escursioni

Esecuzione del 2026-10-18, 12 task con un subagente implementatore e un
revisore indipendente per ciascuno, più una review finale sull'intero lavoro.
Suite da 185 a 200 test; `mcp-check` da 9 a 25 controlli.

## Difetti del piano emersi durante il lavoro

- **Il vincolo di lunghezza del blob era sbagliato** (Task 6). Il piano
  dichiarava «30 POI con note piene sotto i 4000 caratteri»; la misura ha dato
  **4514**. L'implementer ha lasciato il test rosso invece di aggiustare il
  limite, che è il comportamento giusto. Deciso di **abbassare il tetto a 20**
  (misurato: 3087 caratteri) invece di comprimere il blob — avrebbe aggiunto un
  formato con marker di versione dentro un percorso firmato — o di alzare la
  soglia, che sarebbe stato spostare il metro invece dell'oggetto. Piano e task
  successivi aggiornati di conseguenza.
- **Il piano non prevedeva l'aggiornamento della pagina di conoscenza**:
  omissione rilevata dalla review finale. Fatto a parte, con il controllo di
  `wm-context-guard` (vedi sotto).

## Bug trovati

- **La tabella dei sentieri nella scheda era illeggibile** (Task 10), e nessun
  test poteva vederlo: 27 righe, col sentiero 100 ripetuto quattro volte e il
  141 cinque, perché `compactRoute` separa per tipo di fondo — un dato che
  nella tabella non compare. Per il lettore erano duplicati inspiegabili su
  quasi una pagina intera. Raggruppate per numero e difficoltà **solo nella
  scheda**, frammenti sotto i 200 m accorpati: 27 righe → 9, PDF da 3 pagine a
  2. Trovato guardando il PDF.
- **Un controllo che non controllava** (Task 10): `scheda-check` pretendeva
  «più di 500 pixel non trasparenti» per dire che il profilo c'era, ma griglia
  ed etichette ne coprono già di più — sarebbe passato con la linea assente.
  Corretto contando i pixel del tracciato; e poiché la misura reale era 1060
  contro una soglia di 1000 (margine del 6%, rosso al primo restringimento
  della pagina), la soglia è diventata proporzionale alla larghezza del canvas.
- **Un controllo di sicurezza che non attraversava il codice sorvegliato**
  (Task 12): `log-check` chiamava `/g/scheda` e `/g/gpx` con un blob fuori
  area, quindi rispondevano 400 e il percorso di successo — dove osmId e note
  vengono davvero toccati — non girava mai. Sarebbe passato anche con un log
  che scriveva quei dati. Corretto con un blob dentro l'area e l'asserzione
  dei codici attesi.
- **I test erano diventati non portabili** (Task 8): leggevano
  `data/ways.sqlite`, che è in `.gitignore`. Su un clone pulito la suite
  sarebbe fallita. Spostati su una fixture temporanea.

## Decisioni

- **`resolvePoi` non rimanda indietro gli input malformati** (Task 5). Prima,
  un oggetto passato dal modello tornava intatto nella risposta: contraddiceva
  il tipo dichiarato e soprattutto riportava in chat testo scritto dal modello
  stesso, che è il meccanismo di un'injection riflessa. Ora `mancanti` contiene
  solo interi sicuri non trovati e gli input non validi si **contano** in
  `nonValidi`.
- **Un guasto del database non si racconta come POI inesistente** (Task 8).
  `resolvePoi` porta `errore: true` quando il file o la tabella mancano, e
  `giro_finale` risponde `dati_non_disponibili`: senza, il modello avrebbe
  detto all'utente «quel punto non è più nei dati» mentre il problema era
  nostro. Lo stesso principio è stato esteso al GPX nella fix wave finale.
- **Un blob malformato riceve `firma_non_valida`**, la stessa risposta di uno
  manomesso (Task 6): sono indistinguibili dal punto di vista del servizio, e
  due errori diversi direbbero a chi prova quale strada è più promettente.
- **«Senza numero» resta una riga sola** nella tabella dei sentieri anche con
  difficoltà miste (Task 10): non è l'identità di un sentiero ma la sua
  assenza, e spezzarla ricreerebbe le righe apparentemente uguali che si
  stavano togliendo.
- **L'attribuzione delle note sta nel metadata del GPX, non su ogni waypoint**
  (fix finale): su un display da GPS un prefisso ripetuto occuperebbe lo
  schermo. Compare solo quando ci sono note, così i GPX senza note restano
  byte per byte identici.
- **Il tetto dei POI si applica prima della deduplica**: 21 voci di cui alcune
  ripetute danno `troppi_poi` anche se il blob ne conterrebbe meno. Marginale,
  lasciato così.

## Follow-up

Rilievi delle review rimandati di proposito, nessuno bloccante:

- `MAX_POI` definito due volte (`server.js` e `link.js`): vale un import.
- `readFileSync` della scheda a ogni richiesta: si legge una volta sola alla
  costruzione del router.
- `righeSentieri` (la logica che ha portato il PDF da 3 pagine a 2) vive dentro
  lo script della pagina e non ha test unitari: estrarla in un modulo puro
  costerebbe poco.
- Il PNG viaggia dal tool al wrapper con una proprietà `Symbol` non
  enumerabile: funziona ed è testato, ma un `{...out}` futuro perderebbe
  l'immagine in silenzio. Se si tocca quel punto, meglio una coppia esplicita.
- `Math.min/max` con spread in `profilo-scala.js`: oltre ~200k punti va in
  stack overflow (misurato). Fuori dalle dimensioni reali; un `reduce` lo
  chiuderebbe.
- `preview.js` dipende dall'ordine di esecuzione fra il modulo inline e lo
  script `defer`: quando si potrà, farlo diventare un modulo e importare
  direttamente.
- Il test negativo sul gate è basato su espressioni regolari: cattura le
  formulazioni provate, non ogni parafrasi.
- Nella scheda il profilo è una sola linea, senza i colori per criterio della
  preview, perché `scheda.json` non porta i segmenti. Su un foglio stampato in
  bianco e nero i colori si perderebbero comunque: da confermare col dev.
- CSP e SRI sulla scheda, che carica OpenLayers da CDN: è la stessa postura
  già in produzione sulla preview, non introdotta da questo lavoro, ma la
  scheda porta un blob ed è il punto da cui partire se si volesse alzarla.

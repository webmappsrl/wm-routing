# Progettazione escursioni via MCP

## Come funziona oggi

- **MCP server nel gateway** (`gateway/src/mcp/`), wrapper di `/v1`, con tre tool:
  - `route`: percorso calcolato e risposta compatta per un LLM — totali, tappe,
    sentieri per ref, campione di geometria, avvisi compreso il **fuori-area con
    l'area dichiarata** — più il **profilo altimetrico come immagine** (blocco
    `image` del protocollo) e i link `linkPreview` e `linkGpx`;
  - `poi_nearby`: punti di interesse vicino a un punto, con nome, tipo, quota,
    osmId e i tag `wikipedia`/`wikidata` come soli identificatori;
  - `giro_finale`: da chiamare **dopo la conferma dell'utente**; riceve i POI
    scelti **come osmId** più una nota di una riga, e restituisce i link al GPX
    arricchito e alla scheda, oltre a `poiRisolti` e `poiMancanti`.
- **Metodo a fasi nelle istruzioni del server**: vincoli → stagione e meteo →
  varianti → arricchimento → **gate di conferma** → export. I passi si saltano
  quando l'informazione c'è già, il gate no. La data si chiede fra i vincoli
  senza imporla; senza data vale comunque la stagione dalla data di oggi; oltre
  l'orizzonte utile non si inventa una previsione. Il meteo è un **ingresso
  della progettazione** e cambia l'itinerario (riparo o sorgente dai POI), non
  una risposta a una domanda; la previsione la recupera il client, il servizio
  non la fornisce.
- **Due transport, stesso codice dei tool**: stdio in locale (`npm run mcp`,
  da registrare nel client) e rotta `/mcp` streamable HTTP stateless, con token
  in query string (`WM_MCP_TOKEN`), interruttore `WM_MCP_ENABLED` e rate limit.
  I segreti stanno solo in variabili d'ambiente.
- **Deliverable firmati e autodescrittivi**: il blob di `/g/?t=…` porta punti,
  profilo, data dei dati e POI come osmId, firmati HMAC — **nessuno stato sul
  server**, l'URL fa da identificatore. `/g/` espande verso la preview con
  banner se i dati sono cambiati; `/g/gpx` serve il GPX con i **waypoint
  nominati** (nome e quota dal database, nota dal blob); `/g/scheda` è la pagina
  stampabile — mappa, profilo, numeri, tappe, sentieri e luoghi — che si salva
  in PDF dal browser. Un link alterato o troncato **fallisce in modo rumoroso**:
  pagina di errore esplicita, mai un giro diverso.
- **POI dal pre-passo**: `prepare/enrich.py` estrae in `ways.sqlite` la tabella
  `poi` (nodi con nome: cime, valichi, acqua, rifugi e ripari, belvedere,
  abitati). Fail-soft: se l'estrazione fallisce il build resta valido, senza
  tabella.
- **Profilo altimetrico**: la **logica di scala** (`preview/profilo-scala.js`)
  è condivisa fra preview, scheda e server, così i tre profili hanno le stesse
  proporzioni, le stesse tacche e la stessa palette. Il **disegno** ha due
  implementazioni, perché gli ambienti sono diversi: Canvas 2D nel browser
  (`preview/profilo-disegno.js`, usato da preview e scheda) e buffer di pixel
  sul server (`gateway/src/mcp/profilo.js`), dove il PNG si impacchetta con
  `node:zlib` in una cinquantina di righe.
- `tools/log-check.sh` copre `/g/`, `/g/scheda*` e `/mcp`: nei log non devono
  finire coordinate, blob, token, osmId né note.
- Accettazione: `gateway/scripts/mcp-check.mjs` e `scheda-check.mjs`
  (deterministici, senza AI, confrontati con `/v1` vivo e non con valori
  congelati) più la checklist manuale in
  `docs/howto/collaudo-connector-mcp.md`, che copre ciò che non è
  deterministico: la qualità del dialogo.

## Perché così

- **L'inference la paga l'utente** col suo abbonamento, collegando il connector
  al proprio account: la via opposta è vietata da Anthropic (feb 2026) e su
  domanda per i partner su OpenAI.
- **Il modello non fornisce mai dati.** Ai tool passa identificatori; nome,
  posizione e quota li risolve il server dalla tabella `poi`. È la ragione per
  cui la firma HMAC vale qualcosa: certifica un dato nostro, non una
  trascrizione. Per lo stesso motivo gli input malformati non tornano indietro
  al modello (si contano soltanto), e un guasto del database non viene
  raccontato come «quel punto non esiste più».
- **La misura che regge la regola**: nello spike del 2026-10-17, senza i tool
  una tappa veniva stimata 16-18 km e 6-6,5 ore contro i 22,8 km e 8,6 ore del
  motore — più di due ore di errore su una giornata attorno a cui si prenota il
  pernottamento. Con i tool, numeri riproducibili e ref tutti esistenti.
- **I deliverable si portano dietro il proprio significato**: il link firmato
  porta la data dei dati, il GPX l'avvertenza, il profilo le sue etichette.
  Un'immagine o un file viaggiano senza la conversazione che li ha prodotti.
- **Tetto di 20 POI nel blob**: misurato, 30 POI con note piene danno 4514
  caratteri e il link smette di essere incollabile; con 20 siamo a 3087.
  Scartata la compressione del blob, che avrebbe aggiunto un formato con marker
  di versione dentro un percorso firmato, per guadagnare caratteri in un
  meccanismo il cui valore è essere semplice da verificare.
- **Nessuna dipendenza nuova nel gateway**: l'encoder PNG usa `node:zlib`, e la
  scheda si stampa dal browser invece di generare un PDF lato server.
- **Il gate è best-effort e dichiarato tale**: protegge i deliverable che
  incorporano la conversazione, non il `linkGpx` nudo, che è il dato grezzo che
  il motore darebbe comunque. Vive nelle istruzioni, quindi su un client che le
  ignora la v1.1 degrada alla v1 più il profilo: meno guidata, non rotta.

## Come ci siamo arrivati

- **Sintesi e traduzione dei contenuti a runtime per l'app di massa**
  (scartato): l'app dei visitatori serve contenuto offline e revisionato;
  osmfeatures resta per quel flusso.
- **Chat dentro l'app Webmapp sull'abbonamento AI dell'utente** (scartato):
  vedi la prima voce di «Perché così».
- **Skill installabile come veicolo della conoscenza** (scartato): attrito su N
  piattaforme; le istruzioni viaggiano nel server e si aggiornano senza toccare
  l'utente.
- **Tool wiki passthrough lato server** (scartato): il client ha già i suoi
  strumenti web, e un passthrough sarebbe il primo passo per ricostruire la
  manutenzione di contenuti che si voleva eliminare.
- **Archiviazione del testo georeferenziato prodotto dalle AI degli utenti**
  (scartato): il testo derivato invecchia e andrebbe mantenuto, ricreando la
  manutenzione eliminata, ed eredita i vincoli di licenza delle fonti.
- **Il modello che compone i deliverable** (scartato in v1.1): un PDF o un GPX
  scritti dal client richiederebbero di ritrascrivere tutti i numeri, che è il
  difetto che il servizio esiste per eliminare.
- **Tool del meteo lato server** (rimandato): quello che serve non è la
  previsione grezza — che il client sa procurarsi — ma i punti d'interrogazione
  calcolati dalla nostra geometria e dai tempi DIN. È il pattern «tool che
  restituiscono domande, non risposte», materia della v1.2.

Design: [docs/superpowers/specs/2026-10-17-mcp-progettazione-escursioni-design.md](../superpowers/specs/2026-10-17-mcp-progettazione-escursioni-design.md)
· Requisiti e piano: [v1](../features/mcp-progettazione-escursioni/) e
[v1.1](../features/mcp-progettazione-escursioni-v1-1/)

# Progettazione escursioni via MCP

## Come funziona oggi

- **MCP server nel gateway** (`gateway/src/mcp/`), wrapper di `/v1`, con quattro tool:
  - `route`: percorso calcolato e risposta compatta per un LLM — totali, tappe,
    sentieri per ref, campione di geometria, avvisi compreso il **fuori-area con
    l'area dichiarata** — più il **profilo altimetrico come immagine** (blocco
    `image` del protocollo) e i link `linkPreview` e `linkGpx`;
  - `poi_nearby`: punti di interesse vicino a un punto, con nome, tipo, quota,
    osmId e i tag `wikipedia`/`wikidata` come soli identificatori;
  - `giro_finale`: da chiamare **dopo la conferma dell'utente**; riceve i POI
    scelti **come osmId** più una nota di una riga, e restituisce i link al GPX
    arricchito e alla scheda, oltre a `poiRisolti` e `poiMancanti`;
  - `documento_giro`: riceve dall'assistente **solo il suo testo** (introduzione,
    una descrizione per osmId, consigli, fonti come titolo e url, tutto in
    Markdown) più il blob firmato, e restituisce il **documento HTML completo**
    (`documento`, più `nomeFile`) che l'utente salva su disco e stampa. Il testo
    **attraversa** il server e non ci resta: non viene scritto né tenuto in
    memoria (restano in memoria solo i file della preview). Gli osmId che non
    stanno nel blob non entrano nel documento. Un'introduzione, un consiglio o
    un racconto troppo lungo sono un errore esplicito (`testo_troppo_lungo`),
    non un taglio; le fonti non valide o oltre il tetto di 30 si scartano
    senza avviso.
- **Metodo a fasi nelle istruzioni del server**: vincoli → stagione e meteo →
  varianti → arricchimento → **gate di conferma** → export. I passi si saltano
  quando l'informazione c'è già, il gate no. L'**export è in due passi**,
  `giro_finale` e subito dopo `documento_giro`, e le istruzioni chiedono la fase 7
  nella stessa risposta (il codice non lo impone: su un client che le ignora
  l'export può fermarsi a `giro_finale`). Se il documento non nasce (la risposta porta `stato`), l'assistente consegna i link
  e dice che manca e perché. La data si chiede fra i vincoli
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
  stampabile. Un link alterato o troncato **fallisce in modo rumoroso**: pagina
  di errore esplicita, mai un giro diverso.
- **Il documento del giro** è la stessa scheda — mappa, profilo, numeri, tappe,
  sentieri, luoghi — con in più i posti per il racconto dell'assistente, ognuno
  marcato come **scritto da lui**; l'avviso copre solo quelle parti, mai i
  numeri. Il payload è un modulo condiviso (`dati-scheda.js`) fra la rotta
  `/g/scheda.json` e il tool. La scheda legge i dati **inline** se ci sono,
  altrimenti li chiede alla rotta; il documento li porta scritti dentro e
  incorpora anche css e js, perché da `file://` un modulo ES con `src` esterno
  non parte (CORS). Non è autosufficiente in tutto: mappa e codice QR usano
  librerie da CDN, e senza rete restano numeri, profilo, tappe e racconto.
  Nella scheda, e quindi anche nel documento (del documento è solo il
  racconto con le sue fonti):
  - **foto dei luoghi** da Wikipedia **solo per identificatore**
    (`wikipedia`/`wikidata` dal tag OSM), chieste dalla pagina e mai dai nostri
    server; **senza autore e licenza l'immagine non si mostra** (sono quasi
    sempre CC-BY-SA);
  - **GPX scaricabile**, col suo indirizzo scritto per esteso e un QR (che
    manca se il blob è troppo lungo per un codice leggibile, circa oltre 5
    POI) e l'avvertenza che il GPX si ricalcola sul grafo del momento;
  - **fonti divise**: quelle di Webmapp (OpenStreetMap con la data dei dati,
    DIN 33466) e quelle dichiarate dall'assistente, con titolo e indirizzo
    scritti per la carta.
- **Markdown in casa** (`markdown.js`): sottoinsieme minimo, nessuna dipendenza,
  **sicuro per costruzione**: prima l'escaping di tutto il testo, poi i pattern
  sull'output già escapato, e per i link solo `http(s)://` letterali.
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
- **Il documento lo compone una chiamata sola.** Nasce completo o non nasce:
  con due chiamate (prima il link, poi il contenuto) si sarebbe potuto
  consegnare un documento ancora vuoto senza nessun avviso, lo stesso degrado
  silenzioso per cui è stato scartato il fragment.
- **Il testo attraversa il server senza restare.** Conservarlo avrebbe dato al
  documento una scadenza (un foglio che si svuota, un indirizzo che punta al
  nulla) e fatto di Webmapp il custode di prosa nata da una conversazione
  privata. La firma attesta i dati, non il racconto.
- **I numeri non passano mai dal modello**, nemmeno nel documento: l'assistente
  manda testo e osmId, e distanze, dislivelli, tempi e quote li rimette il
  server dal blob e dal motore. Le istruzioni gli dicono di non scriverne nella
  prosa. Non lo impedisce il codice: un numero scritto a mano nel testo
  passerebbe, ed è coperto dall'avviso che marca quella parte come sua.
- **Markdown e non HTML**, e sicuro per costruzione invece che ripulito dopo:
  il testo è di un modello e finisce in una pagina servita da noi; un
  sanificatore a posteriori deve prevedere ogni forma di attacco, un escaping
  fatto prima non ha nulla da prevedere. Per lo stesso motivo il JSON dei dati
  si scrive nel documento con `<` come `\u003c` e le sostituzioni passano da
  funzioni, non da stringhe (`$&` avrebbe rimesso nel documento il tag
  non escapato).
- **I deliverable si portano dietro il proprio significato**: il link firmato
  porta la data dei dati, il GPX l'avvertenza, il profilo le sue etichette.
  Un'immagine o un file viaggiano senza la conversazione che li ha prodotti.
- **Tetto di 20 POI nel blob**: misurato, 30 POI con note piene danno 4514
  caratteri e il link smette di essere incollabile; con 20 siamo a 3087.
  Scartata la compressione del blob, che avrebbe aggiunto un formato con marker
  di versione dentro un percorso firmato, per guadagnare caratteri in un
  meccanismo il cui valore è essere semplice da verificare.
- **Nessuna dipendenza nuova nel gateway**: l'encoder PNG usa `node:zlib`, il
  Markdown ha un renderer di casa, e la scheda si stampa dal browser
  invece di generare un PDF lato server.
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
- **Store sul server con scadenza** (scartato in v1.2): ogni documento
  sarebbe scaduto, vedi «Il testo attraversa il server senza restare».
- **Il testo nel fragment dell'URL** (scartato in v1.2): il testo non passerebbe da noi, ma l'indirizzo lo dovrebbe comporre
  a mano il modello, migliaia di caratteri codificati, con degrado silenzioso
  se sbaglia.
- **Foto per posizione su Wikimedia Commons** (provata e scartata in v1.2),
  misurata su tre punti del giro di Calci: sul Monte Serra, l'unico col tag
  wiki, nulla entro 300 m; sul Monte Verruca cinque immagini, una delle quali
  una fortezza della Garfagnana geolocalizzata male; su una fontana la foto
  di un cartello stradale. Meglio due o tre foto giuste che materiale
  sbagliato in un documento che per il resto garantiamo dato per dato. Si
  riapre dopo aver visto documenti veri, se le foto mancheranno davvero.
- **Tool del meteo lato server** (rimandato): quello che serve non è la
  previsione grezza — che il client sa procurarsi — ma i punti d'interrogazione
  calcolati dalla nostra geometria e dai tempi DIN. È il pattern «tool che
  restituiscono domande, non risposte», resta rimandato.

Design: [docs/superpowers/specs/2026-10-17-mcp-progettazione-escursioni-design.md](../superpowers/specs/2026-10-17-mcp-progettazione-escursioni-design.md)
· Requisiti e piano: [v1](../features/mcp-progettazione-escursioni/),
[v1.1](../features/mcp-progettazione-escursioni-v1-1/) e
[v1.2](../features/mcp-progettazione-escursioni-v1-2/)

# Collaudo manuale del connector MCP

Il livello deterministico sta in due script, che girano senza AI contro il
gateway vivo e confrontano con `/v1` di quel momento (nessun valore congelato):

- `cd gateway && node scripts/mcp-check.mjs` — tool, link firmati, GPX, blocco
  immagine del profilo, `giro_finale` coi POI veri della cella, `/g/scheda.json`,
  blob manomesso, tetto dei 20 POI;
- `cd gateway && node scripts/scheda-check.mjs` — la scheda nel browser (mappa,
  profilo, numeri, banner, tabella dei sentieri) e il documento prodotto da
  `documento_giro` aperto da `file://`: i valori dei numeri (letti come li legge
  una persona, su un anello e su un giro lineare, dove salita e discesa
  differiscono) e il profilo (pixel del tracciato nel canvas) coincidono con
  la scheda; ogni riquadro dell'assistente (presentazione, luoghi, consigli,
  fonti) c'e', col suo testo e con la riga che lo attribuisce all'assistente;
  senza racconto e' la scheda di oggi (stesso DOM della pagina `/g/scheda`);
  un testo ostile non diventa eseguibile; il GPX scaricabile e' quello del
  giro (traccia punto per punto contro `/v1`, luoghi con nome, posizione e
  quota del database); partenza e arrivo di un giro non ad anello stanno
  dove devono;
- `cd gateway && node scripts/foto-check.mjs` — attribuzione e host delle foto;
- `bash tools/log-check.sh` — nessuna coordinata, blob, nota o testo
  dell'assistente nei log, comprese le chiamate a `documento_giro`.

Questo e' il livello due: la prova con un'AI vera, periodica e dopo ogni
cambio ai tool o alle istruzioni. Copre cio' che gli script non possono
coprire, la qualita' del dialogo. Non e' un test automatico: un modello varia
tra un run e l'altro per natura.

## Preparazione

- **In locale (stdio):** il server e' registrato in Claude Code
  (`claude mcp list` deve mostrare `wm-routing`); il gateway locale gira
  (`curl -s http://127.0.0.1:8991/v1/version`).
- **Online (connector):** la rotta e' accesa (`WM_MCP_ENABLED=1`) e il
  connector e' collegato su claude.ai con l'URL col token (vedi
  [infra/mcp.md](../../infra/mcp.md)).

## La richiesta campione

> «Voglio progettare un'escursione col profilo libero da San Giuliano Terme
> al Monte Serra. Preparami il giro.»

(La versione con le coordinate, se l'AI non riesce a geolocalizzare: partenza
lon 10.4420 lat 43.7625, arrivo lon 10.5503 lat 43.7521.)

## Checklist

- [ ] L'AI ha chiamato il tool `route` (non ha risposto a memoria).
- [ ] I numeri in chat (km, dislivello, ore) coincidono con l'output del tool
  — si rileggono dal dettaglio della chiamata nella chat.
- [ ] L'AI ha incollato `linkPreview` intatto; il link apre la preview col
  giro ricostruito e il parametro `d` (banner «dati cambiati» assente se il
  grafo non e' stato rigenerato nel frattempo).
- [ ] `linkGpx` scarica un GPX che si apre (traccia con quote, tappe).
- [ ] Un link manomesso a mano (una lettera cambiata nel `t=`) da' la pagina
  «link alterato», non un giro.
- [ ] Richiesta fuori area («da Milano al lago di Como»): l'AI riferisce che
  l'area coperta e' un'altra, senza inventare un itinerario.
- [ ] Nei log del gateway (`docker compose logs gateway`) nessuna coordinata,
  nessun blob, nessun token — `bash tools/log-check.sh` come controprova.

## Il flusso a fasi

Ogni scenario parte da una conversazione nuova. Si legge il dettaglio delle
chiamate ai tool nella chat, non solo le risposte del modello.

### A. Richiesta vaga

> «Vorrei fare una camminata in Toscana.»

- [ ] L'AI **non** chiama `route` subito: chiede i vincoli mancanti (zona
  precisa, tempo, difficolta', interessi, data).
- [ ] Una domanda per volta, non un elenco di cinque.
- [ ] Non richiede cio' che l'utente ha gia' detto (la Toscana).
- [ ] La data e' chiesta fra i vincoli, senza essere imposta: se l'utente dice
  «non lo so ancora» l'AI prosegue.

### B. Data fornita: stagione e meteo cambiano la proposta

> «Da San Giuliano Terme al Monte Serra, profilo libero, sabato 15 agosto,
> parto presto.» (provare anche una data con temporale previsto in cresta)

- [ ] L'AI valuta stagione e meteo **prima** di proporre le varianti.
- [ ] La valutazione **cambia** la proposta (partenza anticipata, variante che
  scollina prima o con riparo, sorgente come tappa col caldo): non e' un
  commento a margine in fondo.
- [ ] Ripari e sorgenti li cerca con `poi_nearby`, non a memoria.
- [ ] La previsione la recupera con i suoi strumenti; senza data lavora sulla
  stagione di oggi e offre di guardare la previsione. Oltre l'orizzonte utile
  dice che non c'e' previsione, non la inventa.

### C. Varianti a confronto

- [ ] L'AI propone 2-3 varianti, ognuna calcolata con `route` (una chiamata per
  variante).
- [ ] Le confronta coi numeri del tool (km, salita, ore) e col profilo
  altimetrico (immagine mostrata o descritta), dicendo cosa cambia.
- [ ] Ogni numero in chat coincide con l'output del tool corrispondente.
- [ ] Se compare `trattiConAltroProfilo` o `suggerimentoProfilo`, lo riferisce.

### D. Conferma esplicita, solo dopo arrivano GPX e scheda

- [ ] Prima del si' l'AI arricchisce il giro (`poi_nearby`, racconto dei luoghi
  con i suoi strumenti web su `wikipedia`/`wikidata`) e presenta il riepilogo.
- [ ] **Nessuna** chiamata a `giro_finale` prima di un si' chiaro: una risposta
  tiepida («mah», «forse») non conta come conferma.
- [ ] Una modifica chiesta al gate riporta alle varianti o ai POI, non
  all'export.
- [ ] Dopo il si': una sola chiamata a `giro_finale`, con osmId (mai nomi o
  coordinate) e note di una riga.
- [ ] `linkGpx` e `linkScheda` incollati intatti. Il GPX ha i `<wpt>` nominati
  dei POI scelti; la scheda si apre con mappa, profilo, numeri e tabella dei
  sentieri.

### E. Richiesta secca e completa

> «Giro da San Giuliano Terme al Monte Serra, profilo escursionista, senza
> data, niente varianti: fammi solo il GPX.»

- [ ] Nessuna domanda inutile: zona, profilo e punti ci sono gia'.
- [ ] Calcola con `route` e presenta il giro.
- [ ] Il gate **resta**: chiede la conferma prima di `giro_finale`, anche se
  l'utente ha detto «fammi il GPX».

### F. Un osmId che non si risolve

Il lato deterministico (il servizio dichiara `poiMancanti`, non mette il POI
nei file) e' gia' coperto da `mcp-check.mjs` e non si riprova qui. Qui si
verifica solo **il comportamento del modello** davanti a un `poiMancanti`:
non e' un caso riproducibile a mano a comando. Si osserva se capita (POI
sparito dopo una rigenerazione del grafo) oppure si forza in locale con un
osmId inventato passato all'AI come POI scelto.

- [ ] L'AI lo dice all'utente **per nome** (quello mostrato prima), senza
  tacere.
- [ ] Non presenta il POI come presente nei file e consegna normalmente i
  `poiRisolti`.

## Il documento del giro (v1.2)

Questa parte copre cio' che gli script non possono dire: se il documento e'
buono per una persona. Si fa con una conversazione vera, dalla richiesta
campione fino alla fase del documento finale, e si apre il file che l'AI
consegna (`giro-NN.Nkm.html`) con un doppio clic, **da disco e senza rete**
almeno una volta, poi con la rete.

- [ ] **Leggibile.** Il documento prodotto da una conversazione vera si legge da
  cima a fondo: presentazione, mappa, profilo, numeri, tabella dei luoghi,
  consigli, GPX, fonti. Nessun testo che sembra un errore, nessun segno di
  Markdown rimasto in chiaro (asterischi, cancelletti), nessun riquadro vuoto.
- [ ] **I numeri sono quelli della chat.** Km, salita e ore del documento
  coincidono con l'output di `route`/`giro_finale` e col racconto: l'AI non ha
  scritto cifre sue nel testo (se le ha scritte, il racconto le contraddice?).
- [ ] **Le foto compaiono dove esistono.** Con la rete, i luoghi che hanno una
  pagina Wikipedia con immagine (Monte Serra) mostrano la foto nella colonna
  del luogo, con autore e licenza nella didascalia; quelli senza immagine
  restano in tabella senza buco. Senza rete il documento si apre uguale, senza
  foto.
- [ ] **Fatti e racconto si distinguono su un foglio STAMPATO IN BIANCO E NERO.**
  Stampa davvero (o scegli «scala di grigi» e stampante laser, non l'anteprima
  a schermo). Su carta: le parti scritte dall'assistente si riconoscono dal
  riquadro, dal titolo («Presentazione / Consigli dell'assistente», «L'assistente
  racconta») e dalla riga «Scritto dall'assistente dell'utente, non da
  Webmapp», **senza contare sul colore**; numeri, tabelle e mappa si leggono
  come fatti di Webmapp. Chiedi a qualcuno che non ha visto lo schermo di
  indicare quali sono le parti scritte dal modello.
- [ ] **Il QR si legge con un telefono, inquadrando un foglio stampato davvero.**
  Questa prova e' umana e **non e' stata fatta**: la misura del Task 7 e' stata
  fatta su un PDF rasterizzato (stampa ideale), non su carta e fotocamera.
  Stampa il documento di un giro con pochi luoghi (il QR si disegna solo se il
  codice non e' troppo fitto: circa cinque luoghi), inquadra il codice con la
  fotocamera del telefono da una distanza normale di lettura, e verifica che
  proponga l'indirizzo del GPX e che il file si scarichi. Prova anche una
  stampante economica e una carta non perfetta. Se non si legge, il QR va
  tolto o ingrandito: l'indirizzo scritto resta comunque. Segna nelle note
  stampante, carta e telefono usati.
- [ ] **L'indirizzo del GPX stampato e' digitabile.** Su un giro con molti
  luoghi (il QR non c'e') l'indirizzo e' lungo: copialo a mano da un telefono
  in un browser e verifica che scarichi il GPX, oppure annota che e' troppo
  lungo per farlo e cosa si propone.
- [ ] **Su un giro NON ad anello il marcatore della partenza si distingue.**
  Finora e' stato provato solo su un anello, dove partenza e arrivo
  coincidono e il problema non si vede. Con la richiesta campione (San
  Giuliano Terme, Monte Serra) guarda la mappa, a schermo e stampata in
  bianco e nero: il cerchio piccolo della partenza e quello grande
  dell'arrivo si distinguono, la didascalia sotto la mappa dice quale e'
  quale, e nessuno dei due e' coperto dalla linea o dalle etichette dei
  luoghi. (Gli script verificano solo che siano nel punto giusto e con lo
  stile giusto, non che si vedano.)
- [ ] **Un racconto ostile non fa danni.** Chiedi all'AI di includere nel
  racconto un'immagine o un link con `javascript:` (o prova con un testo
  incollato a mano nello script): il documento mostra il testo, non esegue
  niente e non contatta altri host.

## Controlli di contorno

- [ ] Oltre 20 POI: l'AI ne sceglie al massimo 20, oppure riferisce
  `troppi_poi`, senza spezzare il giro in due export.
- [ ] Nei log del gateway nessun osmId, nota o blob: `bash tools/log-check.sh`
  lo dimostra su `/g/scheda*` e su `giro_finale` con una nota riconoscibile.

Esito e stranezze si annotano in
`docs/features/mcp-progettazione-escursioni/notes.md`.

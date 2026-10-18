# Collaudo manuale del connector MCP

Il livello deterministico sta in due script, che girano senza AI contro il
gateway vivo e confrontano con `/v1` di quel momento (nessun valore congelato):

- `cd gateway && node scripts/mcp-check.mjs` — tool, link firmati, GPX, blocco
  immagine del profilo, `giro_finale` coi POI veri della cella, `/g/scheda.json`,
  blob manomesso, tetto dei 20 POI;
- `cd gateway && node scripts/scheda-check.mjs` — la scheda nel browser (mappa,
  profilo, numeri, banner, tabella dei sentieri).

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

## Controlli di contorno

- [ ] Oltre 20 POI: l'AI ne sceglie al massimo 20, oppure riferisce
  `troppi_poi`, senza spezzare il giro in due export.
- [ ] Nei log del gateway nessun osmId, nota o blob: `bash tools/log-check.sh`
  lo dimostra su `/g/scheda*` e su `giro_finale` con una nota riconoscibile.

Esito e stranezze si annotano in
`docs/features/mcp-progettazione-escursioni/notes.md`.

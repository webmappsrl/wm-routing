# CLAUDE.md

## Cos'e' wm-routing

Routing escursionistico di Webmapp: GraphHopper (commit fissato `97f7fde`)
dietro un gateway Node con interfaccia `/v1`, sugli stessi dati OSM e DEM di
wm-tiles. Gira sulla stessa macchina di wm-tiles (`ssh wm-tiles`), in
container, dietro lo stesso Caddy. Lo usano le versioni nuove di app e webapp;
quelle di oggi restano sul GraphHopper di produzione.

## Lingua

Rispondi in italiano. Documentazione, commenti e log in italiano;
identificatori nel codice in inglese.

## Comandi

| Cosa | Comando |
|---|---|
| test del gateway | `cd gateway && npm test` |
| test del pre-passo | `docker run --rm -v "$PWD/prepare":/prepare -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q` |
| motore sulla rete sintetica | `bash engine/tests/smoke.sh` |
| nessuna coordinata nei log | `bash tools/log-check.sh` |
| preview | `cd gateway && node scripts/preview-check.mjs` |
| preview spiegata e su telefono | `cd gateway && node scripts/preview-ux-check.mjs && node scripts/preview-mobile-check.mjs [url] ["iPhone SE"]` |
| accettazione MCP e scheda (gateway vivo) | `cd gateway && node scripts/mcp-check.mjs && node scripts/scheda-check.mjs` |
| foto dei luoghi nel documento (Wikimedia simulata) | `cd gateway && node scripts/foto-check.mjs` |
| confronto con la produzione | `node tools/compare.mjs --giro <nome>` |
| costruire e scambiare il grafo | `bash tools/build-graph.sh <pbf> <terrain.pmtiles>` (runbook) |

## Regole del repo

- **Nessuna coordinata nei log.** Le posizioni mandate per il rientro sono dati
  personali: gateway, Caddy e GraphHopper non registrano corpo, query string o
  punti. Un log nuovo del gateway passa da `gateway/src/log.js`.
  `tools/log-check.sh` verifica i log di gateway e motore (di Caddy non legge
  niente): `/v1/*` sempre, `/g/*` e `/mcp` solo con un `.env` che porti
  `WM_LINK_KEY` e `WM_MCP_TOKEN`. Il messaggio finale dice cosa ha interrogato
  davvero e cosa ha saltato.
- **`WM_V1_TOKEN` e' spento di proposito**: il meccanismo c'e' nel codice, ma
  nessun valore ne' in locale ne' in produzione, e il gateway e' fail-open (senza
  la variabile avvisa all'avvio e parte lo stesso). E' una decisione, non una
  svista: accenderlo vuole prima una scelta sulla preview pubblica (runbook, «La
  credenziale delle rotte dei dati»).
- **Node 18, non 22.** `npm test` e gli script locali del gateway girano col Node
  di serie del Mac (18), per cui `better-sqlite3` e' compilato (`NODE_MODULE_VERSION`
  108): non esportare il PATH del Node 22, che qui lo rompe. Il container del
  gateway ha un Node suo (`gateway/Dockerfile`). In Walkiria vale la regola
  opposta (Node 22 obbligatorio).
- **Dopo una modifica a `prepare/` si ricostruisce l'immagine**:
  `docker build -t wm-routing-prepare prepare/` prima di `build-graph.sh`.
  `build-graph.sh` monta solo `/in` e `/out`, quindi gira con l'`enrich.py` che sta
  dentro l'immagine; i pytest (comando in tabella) montano `prepare/` e provano il
  sorgente. Con l'immagine vecchia i test sono verdi sul codice nuovo e la build
  gira sul vecchio, senza un errore: lo si vede solo dal riassunto (`prepare.json`
  senza le chiavi nuove, `pois` identico a prima).
- **Con il tunnel `ssh -L 8991` aperto (quello che Walkiria fa aprire per i POI) le
  verifiche locali parlano con la produzione.** La porta 8991 e' quella su cui
  `tools/log-check.sh` bussa per default e su cui il compose pubblica il gateway
  locale. Ci si accorge con `lsof -nP -iTCP:8991 -sTCP:LISTEN` (un `ssh`, non
  docker) o con `GET /v1/version`, che risponde col grafo nazionale. Per lavorarci
  intorno: un file di override fuori dal repo con
  `ports: !override ["127.0.0.1:18991:8991"]` per il servizio `gateway`, passato
  con `COMPOSE_FILE=docker-compose.yml:<override>` (e un `COMPOSE_PROJECT_NAME`
  proprio), e l'URL dato a `bash tools/log-check.sh http://127.0.0.1:18991`. Le
  stesse due variabili vanno anche a `log-check`, che legge i log con
  `docker compose logs`. Il tunnel non si chiude.
- **Sul Mac solo l'area di prova** (cella di Pisa); l'area intera si costruisce
  sul server `ssh wm-tiles`. Sulla cella i profili girano senza LM.
- **I profili cambiano versione quando cambia il loro custom model**:
  `gateway/config/profiles.json` porta l'impronta SHA-256 dei file, e un test
  fallisce se non coincide.
- **wm-routing legge i dati di wm-tiles, non il contrario**: nessun passo negli
  script della pipeline di wm-tiles.
- **Le sigle CAI si riportano, non si deducono.** Una sigla della scala CAI
  (`T`, `E`, `EE`, `EEA` a piedi; `TC`, `MC`, `BC`, `OC`, `EC` in bici) si
  scrive solo se quel valore sta nei dati: mai ricavata da un'altra scala
  (`sac_scale`, `mtb:scale`) ne' dalla sede stradale. Dove il dato manca, la
  difficolta' e' sconosciuta e si dice. Il perche' e' nella pagina di conoscenza
  del routing escursionistico.
- **`horse_rating` non si espone e nessun profilo a cavallo puo' usarlo**: e' il
  contenitore delle catene di sentieri sconosciuti (pagina di conoscenza).
- Le direttive per l'app sono in
  `docs/features/routing-escursionistico/map-core.md`: `map-core` non si tocca
  finche' non parte lo sviluppo lato app.

## Conoscenza

| Argomento | Cosa copre | Pagina |
|---|---|---|
| Routing escursionistico | come il servizio ricava difficolta', quote e profili dai dati di wm-tiles, e cosa e' stato scartato | [docs/knowledge/routing-escursionistico.md](docs/knowledge/routing-escursionistico.md) |
| Progettazione escursioni via MCP | come l'AI dell'utente progetta giri sui dati di wm-routing: tool, link firmati, GPX dal server e POI dal pre-passo; i POI hanno un secondo consumatore (Walkiria, rotta interna `/v1/:shard/poi`) con ricerca unica in `src/mcp/poi.js` | [docs/knowledge/mcp-progettazione-escursioni.md](docs/knowledge/mcp-progettazione-escursioni.md) |

## Trappole

- GraphHopper: [.claude/rules/graphhopper.md](.claude/rules/graphhopper.md)

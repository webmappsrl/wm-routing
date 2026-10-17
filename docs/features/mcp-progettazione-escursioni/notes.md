# Notes — Servizio MCP di progettazione escursioni (prima versione)

## Deviazioni dal piano

- **Task 4:** lo shard `mcp` in `shards.json` è stato aggiunto qui invece che
  nel Task 5: serviva già a `/g/gpx` per ricalcolare dal blob. Il Task 5 lo ha
  riusato com'era previsto.
- **Task 4:** l'errore del motore su `/g/gpx` risponde con lo status
  dell'`HttpError` di `/v1` (503 `riprova`, 404 `nessun_percorso`…), non con
  il 502 scritto nel piano: coerenza con il resto del gateway.
- **Task 9:** la cella non è stata rigenerata con `build-graph.sh` — rifiuta
  per costruzione lo stesso data stamp (PBF invariato), e i POI non toccano
  il grafo. Rigenerata solo `ways.sqlite` ripetendo la catena del build
  (clip di `centro.osm.pbf` con il bbox della cella + `enrich.py`) e
  installata nel grafo corrente, con copia di riserva `ways.sqlite.bak`
  accanto.

## Bug trovati

- **`tools/log-check.sh` dava falsi positivi**: il confronto delle coordinate
  usava un frammento corto con il punto come carattere jolly (`6.68`), che
  combaciava con i timestamp dei log (`…06.687Z`). Ora confronto a stringa
  fissa su un frammento a 5 decimali. Scoperto estendendo il check alle rotte
  nuove.
- **Prima rigenerazione di `ways.sqlite` dall'input sbagliato**:
  `data/ritaglio.osm.pbf` è un residuo piccolo (11.552 vie), non il clip
  della cella (184.273). Rifatta dalla catena vera; contatori identici alla
  copia di riserva, più 4.678 POI.

## Decisioni

- I link nei tool sono **assoluti** (`WM_PUBLIC_URL`, in locale
  `http://127.0.0.1:8991`): un link relativo non sarebbe cliccabile in chat.
- La rotta `/mcp` è **stateless**: un server e un transport per richiesta
  (`enableJsonResponse`), niente sessioni da gestire; giusto per il profilo
  di carico del prototipo.
- Lo `.env` locale (gitignorato, aggiunto al `.gitignore` in questo lavoro)
  porta `WM_LINK_KEY`, `WM_MCP_ENABLED`, `WM_MCP_TOKEN` e anche
  `WM_GRAPHS`/`WM_GRAPH_BBOX` della cella: ricreare il container con
  `source tools/bbox.sh` nella stessa shell fa vincere il bbox d'Italia
  sulla cella e il gateway valida punti che il grafo non copre.
- Il server MCP è registrato in Claude Code (`claude mcp add wm-routing`,
  config locale) per il collaudo interattivo.

## Review finale (revisore isolato, 2026-10-17)

Esito: «ready to merge with fixes», zero Critical, tre Important — tutti
corretti in un giro di fix con TDD (suite 101/101, accettazione e log-check
verdi dal vivo):

1. **Fallback invisibile**: `/g/` era composto senza `makeFallbackRoute`
   (un giro consegnato col fallback non scaricava il GPX) e `compact.js`
   scartava `fallbackLegs`. Ora `/g/` usa lo stesso fallback di `/v1`, gli
   avvisi portano `trattiConAltroProfilo` e le istruzioni del server dicono
   all'AI di riferirlo.
2. **Log senza il nome del tool** (e `poi_nearby` non loggava affatto):
   campo `tool` in `log.js`, una riga per chiamata tool. Nel transport stdio
   il logger resta spento di default: lo stdout è il protocollo.
3. **`/g/` senza rate limit**: limite per IP nel router (i link sono
   condivisibili per design e `/g/gpx` costa un calcolo del motore).

## Decisioni dopo la review

- **Istruzioni del server riscritte come flusso guidato** (richiesta di
  Giuseppe alla prima prova): la sola frase «per i luoghi usa i tuoi
  strumenti web» non bastava a far arricchire l'itinerario da solo. Ora le
  istruzioni prescrivono la sequenza route → `poi_nearby` sui punti salienti
  → strumenti web del client sugli identificatori → consegna con racconto.
  È il tipo di ritocco per cui le istruzioni vivono nel server: si aggiorna
  qui e vale per tutti i client, senza reinstallare nulla.

## Follow-up

- Collaudo manuale col connector reale su claude.ai quando la rotta andrà
  sul server (checklist: `docs/howto/collaudo-connector-mcp.md`).
- Alla pubblicazione sul server: blocco Caddy per `/mcp` (SSE) come da
  `infra/mcp.md`.
- `data/grafi/<stamp>/ways.sqlite.bak` si può togliere quando il nuovo
  `ways.sqlite` ha girato qualche giorno senza sorprese.
- Minor della review finale, rimandati di proposito: `timingSafeEqual` sui
  confronti dei segreti; flip del blob non garantito in `mcp-check.mjs`
  (~1-2% di falsi ko); `log-check.sh` non avvisa se salta i controlli
  `/g`/`/mcp` per mancanza di `.env`; nessun test del mount condizionale
  «spento → 404»; `infra/mcp.md` non dice che `/mcp` richiede anche
  `WM_MCP_TOKEN` e `WM_LINK_KEY`; `prepare/__pycache__/*.pyc` tracciati
  (igiene preesistente); `extract_pois` fa una passata in più sul PBF
  (pesa solo sul nazionale).

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
| test del pre-passo | `docker run --rm -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q` |
| motore sulla rete sintetica | `bash engine/tests/smoke.sh` |
| nessuna coordinata nei log | `bash tools/log-check.sh` |
| preview | `cd gateway && node scripts/preview-check.mjs` |
| preview spiegata e su telefono | `cd gateway && node scripts/preview-ux-check.mjs && node scripts/preview-mobile-check.mjs [url] ["iPhone SE"]` |
| confronto con la produzione | `node tools/compare.mjs --giro <nome>` |
| costruire e scambiare il grafo | `bash tools/build-graph.sh <pbf> <terrain.pmtiles>` (runbook) |

## Regole del repo

- **Nessuna coordinata nei log.** Le posizioni mandate per il rientro sono dati
  personali: gateway, Caddy e GraphHopper non registrano corpo, query string o
  punti. Un log nuovo del gateway passa da `gateway/src/log.js`.
  `tools/log-check.sh` lo verifica.
- **Sul Mac solo l'area di prova** (cella di Pisa); l'area intera si costruisce
  sul server `ssh wm-tiles`. Sulla cella i profili girano senza LM.
- **I profili cambiano versione quando cambia il loro custom model**:
  `gateway/config/profiles.json` porta l'impronta SHA-256 dei file, e un test
  fallisce se non coincide.
- **wm-routing legge i dati di wm-tiles, non il contrario**: nessun passo negli
  script della pipeline di wm-tiles.
- **`horse_rating` non si espone e nessun profilo a cavallo puo' usarlo**: e' il
  contenitore delle catene di sentieri sconosciuti (pagina di conoscenza).
- Le direttive per l'app sono in
  `docs/features/routing-escursionistico/map-core.md`: `map-core` non si tocca
  finche' non parte lo sviluppo lato app.

## Conoscenza

| Argomento | Cosa copre | Pagina |
|---|---|---|
| Routing escursionistico | come il servizio ricava difficolta', quote e profili dai dati di wm-tiles, e cosa e' stato scartato | [docs/knowledge/routing-escursionistico.md](docs/knowledge/routing-escursionistico.md) |

## Trappole

- GraphHopper: [.claude/rules/graphhopper.md](.claude/rules/graphhopper.md)

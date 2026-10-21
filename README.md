# wm-routing

Routing escursionistico di Webmapp: GraphHopper dietro un gateway Node, sugli
stessi dati OSM e DEM di [wm-tiles](https://github.com/webmappsrl/wm-tiles).

| Pezzo | Cartella | Cosa fa |
|---|---|---|
| pre-passo | `prepare/` | ritaglia il PBF sul rettangolo del DEM e vi scrive la difficolta' CAI effettiva, le catene di sentieri sconosciuti, ghiacciai, zone militari e vie ferrate; tabella laterale `ways.sqlite` |
| motore | `engine/` | GraphHopper compilato da un commit fissato, cinque profili come custom model, quote da un PMTiles z13 |
| gateway | `gateway/` | interfaccia pubblica `/v1`: shard e profili, CORS, limite di richieste, dettagli per tratto, tempo DIN 33466, rientro sulla traccia; server MCP (`gateway/src/mcp/`, stdio e rotta `/mcp`) con link firmati `/g/` e GPX dal server |
| preview | `preview/` | pagina OpenLayers che confronta il motore nuovo con il GraphHopper di produzione |

```bash
cd gateway && npm test            # test del gateway
bash engine/tests/smoke.sh        # motore sulla rete sintetica
cd gateway && node scripts/mcp-check.mjs   # accettazione del servizio MCP (gateway vivo)
cd gateway && node scripts/scheda-check.mjs   # accettazione della scheda del giro (Playwright)
source tools/bbox.sh && docker compose up -d
```

Esercizio, aggiornamento notturno e ritorno al grafo precedente:
[docs/runbook.md](docs/runbook.md). Il lavoro che ha dato origine al servizio:
[docs/features/routing-escursionistico/](docs/features/routing-escursionistico/).

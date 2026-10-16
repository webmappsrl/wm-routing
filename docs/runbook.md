# Runbook di wm-routing

Il servizio gira sulla stessa macchina di wm-tiles (`ssh wm-tiles`), in
container, dietro il Caddy del server. Ogni comando `docker compose` a mano va
preceduto da `source tools/bbox.sh`, che contiene l'unico rettangolo del grafo.

## Preparazione

```bash
git clone https://github.com/webmappsrl/wm-routing.git /srv/wm-routing && cd /srv/wm-routing
docker build -t wm-routing-prepare prepare/
docker build -t wm-routing-dem dem/
docker build -t wm-routing-engine:97f7fde engine/
mkdir -p /var/lib/wm-routing/grafi /data/wm-routing      # grafi sul disco locale, non sul Volume
# quote: le tile Terrarium z13 di wm-tiles, impacchettate (solo z13: GraphHopper ne legge uno)
docker run --rm -v /data/wm-tiles/dem/terrain:/in:ro -v /data/wm-routing:/out wm-routing-dem \
  python pack-terrain.py /in /out/terrain.pmtiles 13 6.6,35.4,18.6,47.1
# percorsi di prova sull'area intera: li usa il controllo prima dello scambio
docker run --rm -v /data/wm-tiles/sources:/in:ro -v "$PWD/tools":/tools:ro wm-routing-prepare \
  python /tools/pick-routes.py /in/italia.osm.pbf 60 > compare/routes.json
```

## Primo avvio

```bash
bash tools/build-graph.sh /data/wm-tiles/sources/italia.osm.pbf /data/wm-routing/terrain.pmtiles
DOMINIO=routing.maphub.it bash infra/pubblica-routing.sh
bash tools/log-check.sh
```

`build-graph.sh` ritaglia e arricchisce il PBF, controlla che ogni via abbia
quote, importa, avvia il grafo nuovo su una porta interna, lo controlla con i
percorsi di prova e solo allora lo mette in uso e riavvia i servizi.

Codici d'uscita: **2** dati mancanti o incoerenti (PBF senza data, rettangoli
che non tornano, tile senza quote), **3** controllo fallito (percorsi di prova
falliti, quote a zero, nodi calati oltre il 5%), **75** rinviato (rigenerazione
di wm-tiles in corso o memoria libera insufficiente). In tutti e tre i casi il
grafo in uso resta quello di prima.

## Aggiornamento notturno

```
15 3 * * * /srv/wm-routing/tools/check-data.sh >> /var/log/wm-routing-dati.log 2>&1
```

`check-data.sh` ricostruisce solo se la data del PBF di wm-tiles
(`osmosis_replication_timestamp`, scritta da `aggiorna-osm.sh`) e' cambiata.

## Tornare al grafo precedente

Si tengono il grafo in uso e quello di prima:

```bash
ls -1d /var/lib/wm-routing/grafi/20*
ln -sfn /var/lib/wm-routing/grafi/<cartella precedente> /var/lib/wm-routing/grafi/corrente
source tools/bbox.sh && docker compose up -d --force-recreate engine gateway
```

## Togliere il servizio

```bash
source tools/bbox.sh && docker compose down
rm /etc/caddy/siti/routing.caddy && systemctl reload caddy
```

Nella pipeline di wm-tiles non c'e' niente da annullare.

## Spegnimento del GraphHopper di produzione

Criterio (overview): meno di 50 richieste al giorno dalle app per 30 giorni di
fila, senza contare i bot ne' la preview di wm-routing, che lo usa come termine
di confronto. Il conteggio si fa sul server di `graphhopper.webmapp.it`, senza
query string, quindi senza coordinate.

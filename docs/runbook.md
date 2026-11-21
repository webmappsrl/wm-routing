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

## Rilascio

Vale per ogni messa in produzione dopo la prima: codice nuovo, configurazione di
Caddy nuova, o tutte e due. **I due passi vanno in quest'ordine e nessuno dei due
e' opzionale.**

```bash
cd /srv/wm-routing && git pull
# 1. PRIMA Caddy. Lo script riscrive /etc/caddy/siti/routing.caddy da zero ed e'
#    la sola fonte di quel file: matcher delle rotte interne e blocco /mcp
#    compresi. Non lo rilancia nessun altro: ne' build-graph.sh, ne'
#    check-data.sh, ne' `docker compose up`. Saltarlo lascia sul server la
#    configurazione vecchia, e una rotta interna nuova nasce pubblica.
DOMINIO=routing.maphub.it bash infra/pubblica-routing.sh
# 2. POI il gateway.
source tools/bbox.sh && docker compose up -d --build gateway
bash tools/log-check.sh
```

**Perche' Caddy per primo.** Fra i due comandi c'e' una finestra in cui le due
parti non sono allineate, e l'errore non e' simmetrico. Caddy per primo: in
quella finestra una rotta interna nuova riceve `404` da Caddy mentre il gateway
non la serve ancora, e un `404` su una rotta che non esiste non fa male a
nessuno. Gateway per primo: la rotta esiste e non e' protetta, quindi per tutta
la durata del riavvio e' raggiungibile da internet.

Lo script si controlla da solo: dopo il reload chiede `/v1/version` e verifica
che `/v1/walkiria/poi`, con e senza slash finale, risponda `404` da internet. Se
non e' cosi' esce con errore, e una configurazione in cui la protezione non
funziona non resta pubblicata. La verifica a mano, piu' larga, e' in
«[La rotta dei POI resta interna](#la-rotta-dei-poi-resta-interna)».

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

## La rotta dei POI resta interna

`GET /v1/:shard/poi` serve il backend di Walkiria, che gira sulla stessa macchina e
raggiunge il gateway dalla rete interna (`127.0.0.1:8991`). **Caddy non deve
pubblicarla**, e non va fatto a mano: `infra/pubblica-routing.sh` genera
`/etc/caddy/siti/routing.caddy` con la regola `@interne path /v1/*/poi /v1/*/poi/` (anche con lo slash finale, che Express serve) +
`respond @interne 404` prima del `reverse_proxy`. Una regola scritta a mano sul server
verrebbe cancellata al rilancio dello script, quindi la protezione sta nello script.
Lo stesso vale per tutto il resto di quel file, blocco `/mcp` compreso: lo script lo
riscrive da zero ed e' la sua sola fonte (vedi «Rilascio» e `infra/mcp.md`).

Verifica dopo ogni deploy o rilancio dello script: e' quella che dimostra che la
protezione c'e' davvero. Vanno controllate **tutte e due le direzioni** nello stesso
momento: che la regola blocchi la rotta POI, e che non blocchi nient'altro. Il secondo
errore (un matcher che intercetta piu' del dovuto) non lo vedrebbe nessuno al deploy e si
manifesterebbe come il servizio di routing che smette di rispondere a tutti: un guasto
piu' grave di quello che la regola previene.

I comandi sono due blocchi distinti, da eseguire in due posti diversi.

**Primo blocco, da una macchina esterna** (la prova dal server vale gia': la richiesta esce
sul dominio pubblico e rientra da Caddy, come fa l'auto-verifica dello script; da fuori
si prova in piu' che DNS e certificato pubblico funzionano).

```bash
D=https://routing.maphub.it
# ATTENZIONE: questo blocco non prova niente sulla credenziale. Se il gateway
# non la chiede, l'intestazione qui sotto parte senza valore, il gateway non la
# guarda, e i comandi riescono lo stesso: l'esito atteso arriva perche'
# credenziale non ce n'e', non perche' quella mandata sia quella giusta. Qui si
# prova il matcher di Caddy, e per quello il blocco vale. Se la credenziale sia
# accesa o no si chiede al servizio, col curl della sezione «La credenziale
# delle rotte dei dati»; i comandi qui sotto non cambiano in nessuno dei due
# casi, basta avere WM_V1_TOKEN nell'ambiente. GET /v1/version resta comunque
# aperta.
A="Authorization: Bearer $WM_V1_TOKEN"
# la rotta POI non deve esistere: atteso "404 0" (codice e byte scaricati).
# Il 404 di Caddy non ha corpo; il 404 del gateway porta un JSON di una trentina
# di byte. Senza la dimensione i due sarebbero indistinguibili, e se un domani lo
# shard walkiria sparisse la verifica direbbe "protetta" anche senza matcher.
curl -s -o /dev/null -w 'poi:         %{http_code} %{size_download}B\n' -H "$A" "$D/v1/walkiria/poi?lon=10.5&lat=43.75"
# con lo slash finale: atteso "404 0" (senza, la regola sarebbe aggirata da Express)
curl -s -o /dev/null -w 'poi/:        %{http_code} %{size_download}B\n' -H "$A" "$D/v1/walkiria/poi/?lon=10.5&lat=43.75"
# il resto deve passare: atteso 200 con un corpo non vuoto, entrambe
curl -s -o /dev/null -w 'route:       %{http_code} %{size_download}B\n' "$D/v1/walkiria/route" -H "$A" -H 'Content-Type: application/json' \
  -d '{"profile":"escursionista","points":[[10.30595,43.94908],[10.30479,43.99193]]}'
curl -s -o /dev/null -w 'version:     %{http_code} %{size_download}B\n' "$D/v1/version"
```

**Secondo blocco, sul server** (`ssh wm-tiles`), direttamente sul gateway senza passare
da Caddy: la rotta deve funzionare, altrimenti Walkiria non ha i POI.

```bash
# anche qui l'intestazione non cambia l'esito finche' il gateway non chiede la
# credenziale (vedi «La credenziale delle rotte dei dati»). Resta scritta: e' la
# stessa chiamata da rilanciare col token vero il giorno in cui sara' accesa
curl -s -o /dev/null -w 'poi interna: %{http_code} %{size_download}B\n' \
  -H "Authorization: Bearer $WM_V1_TOKEN" \
  'http://127.0.0.1:8991/v1/walkiria/poi?lon=10.5&lat=43.75'
```

Come si leggono gli esiti:

| Esito esterno su `poi` e `poi/` | Cosa vuol dire |
|---|---|
| `404 0B` | il 404 e' di Caddy: la protezione c'e' |
| `404` con un corpo | risponde il gateway, quindi la richiesta e' passata: il matcher non c'e' |
| `200` | la rotta e' esposta |

Se le chiamate POI esterne non danno `404 0B`, la rotta non e' protetta: rilanciare
`infra/pubblica-routing.sh` (vedi «Rilascio») e ripetere la verifica. Se `route` o
`version` non rispondono `200` il matcher e' troppo largo: correggere lo script e
rilanciarlo subito. Se la chiamata interna non risponde `200`, il problema e' il
gateway, non Caddy.

## La credenziale delle rotte dei dati

Quello che segue e' lo stato al **2026-11-21**. Per lo stato di adesso non
fidarti di questa pagina: chiedilo al servizio, col comando qui sotto. Chi
accende la credenziale riscrive questa sezione **e** i commenti dei due blocchi
di verifica della rotta POI, qui sopra.

La prova, da fare sul server (`ssh wm-tiles`), e' una richiesta a una rotta dei
dati **senza** intestazione. Non c'e' nessun segreto in gioco:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8991/v1/walkiria/route
```

`401` vuol dire credenziale accesa. Qualunque altro esito vuol dire rotte
aperte: `400` e' il gateway che si lamenta del corpo della richiesta, cioe' ha
servito una richiesta che nessuno ha autorizzato. Lo stesso comando vale dal
dominio pubblico (`https://routing.maphub.it/v1/walkiria/route`), che e' come e'
stato misurato lo stato scritto qui: `400`, non `401`.

Al 2026-11-21, quindi, **le rotte `/v1/<shard>/*` sono aperte** a chiunque
raggiunga il gateway: da internet tutto tranne `/v1/*/poi`, che ferma Caddy
(vedi sopra); dalla macchina del server, tutto. Nello `.env` di sviluppo di
questo repo `WM_V1_TOKEN` non c'e'; che cosa ci sia nello `.env` del server il
`curl` non lo dice, e non serve saperlo: conta l'esito.

Con la credenziale accesa, una richiesta a `/v1/<shard>/*` senza
`Authorization: Bearer <token>` riceve `401 {"stato":"non_autorizzato"}`, e il
controllo sta prima del limite di richieste, cosi' una richiesta respinta non
consuma il secchio di qualcun altro. `GET /v1/version` non passa da quel
controllo e resta aperta in ogni caso: e' la prova di vita che
`infra/pubblica-routing.sh` usa dopo il reload di Caddy.

Il meccanismo e' **fail-open per costruzione**: senza la variabile il gateway
parte lo stesso e si limita ad avvisare (`gateway/src/server.js:37-38`, riga
`ATTENZIONE: WM_V1_TOKEN assente, le rotte /v1 sono aperte a chiunque`). E'
voluto, perche' sul Mac si lavora senza segreti. L'avviso nel log e' un indizio
in piu', non una prova: **zero righe non vuol dire niente da solo**. Un gateway
piu' vecchio del commit che ha introdotto il controllo non stampa quell'avviso e
ha le rotte del tutto aperte; `grep -c` risponde `0` anche quando `docker
compose logs` fallisce, perche' l'errore non passa nella pipe; e il gateway
scrive una riga per richiesta, quindi con la rotazione dei log la riga d'avvio
sparisce da sola. L'esito del `curl` qui sopra invece misura il comportamento, e
vale anche su un gateway vecchio.

### Cosa va sistemato prima di accenderla

- **La preview pubblica.** `preview/preview.js` (righe 325, 1213, 1416) chiama
  `/v1/<shard>/route`, `/v1/<shard>/rejoin` e `/v1/<shard>/profiles` **dal
  browser**, con `SHARD = 'preview'`. Una pagina pubblica non puo' tenere un
  segreto: un token scritto li' dentro lo leggono tutti, e quindi non e' un
  token. La scelta e' aperta e nessuno l'ha ancora fatta: lasciare lo shard
  `preview` senza credenziale, chiudere la preview pubblica, oppure metterla
  dietro qualcosa che inietti l'intestazione al posto della pagina.
- **Il backend di Walkiria**: nessun codice da scrivere, ma una variabile da
  impostare. Il suo client sa gia' mandare l'intestazione
  (`server/src/itinerary/routing.ts`, che avvolge la `fetch` del client e mette
  `Authorization: Bearer <token>` quando il token c'e'); in
  `packages/api-client/src/` la `fetch` e' una sola, quindi ci passano tutte le
  chiamate, `route`, `poi`, `rejoin`, `profiles` e `version`. Serve
  `WM_ROUTING_TOKEN` nel suo `.env`, con lo stesso valore di `WM_V1_TOKEN` di
  qui; senza, il token resta nullo, l'intestazione non parte e Walkiria resta
  senza POI e senza percorsi. In locale, con il tunnel, va impostata anche
  `WM_ROUTING_POI_URL`, che e' un'altra faccenda ma si incontra nello stesso
  momento. Nota per l'altro repo: `.env.example:92` e `server/src/config.ts:52`
  dicono ancora che il gateway non ha autenticazione: vero oggi, da aggiornare
  li' il giorno dell'accensione.
- **Il connettore MCP invece e' gia' a posto.** I suoi tool escono dal processo e
  rientrano da `POST /v1/mcp/route`: l'intestazione la mette
  `gateway/src/mcp/v1-auth.js`, purche' il processo abbia `WM_V1_TOKEN`
  nell'ambiente (lo passa il compose).

## Spegnimento del GraphHopper di produzione

Criterio (overview): meno di 50 richieste al giorno dalle app per 30 giorni di
fila, senza contare i bot ne' la preview di wm-routing, che lo usa come termine
di confronto. Il conteggio si fa sul server di `graphhopper.webmapp.it`, senza
query string, quindi senza coordinate.

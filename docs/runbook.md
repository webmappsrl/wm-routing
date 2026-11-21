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

L'arricchimento (`prepare/enrich.py`) produce in `ways.sqlite`, oltre alle vie, la
tabella `poi` (con citta' e paesi: `city`, `town`, `village`, `hamlet`, `locality`)
e la tabella `area`: regioni amministrative (livello 4) e zone (`place=region`),
ognuna col proprio rettangolo. `area` si riscrive da zero a ogni arricchimento.
Un grafo costruito prima di questa modifica non ha la tabella: `/areas` risponde
`200` con `vuoto: "dati senza aree: grafo da rigenerare"`, non un errore. Si
rigenera con `build-graph.sh` a mano e, se il dato OSM non e' cambiato, con
`WM_REBUILD_SAME_DATA=1` (vedi sotto), perche' `check-data.sh` ricostruisce solo se
la data del PBF o delle quote e' cambiata. Prima dello scambio il controllo
guarda anche il riassunto del pre-passo (`prepare.json`): se `ways` o `pois` sono a
zero, o calano oltre il 5% rispetto al grafo in uso, esce con **3**. Le aree sono
un caso a parte: si pretendono solo se il pre-passo ne ha viste nel file
(`areas_seen`). Fermano lo scambio se sono a zero pur essendocene nel file, se
calano oltre il 5% per tipo, o se il grafo in uso ne aveva e il nuovo non ne vede
piu' nessuna. Su un estratto ritagliato come la cella di prova le relazioni
perdono i membri fuori dal rettangolo, `areas_seen` resta vuoto e la tabella
`area` esce vuota senza fermare niente.

### Ricostruire con lo stesso dato

`build-graph.sh` da' alla cartella del grafo la data del dato OSM, e rifiuta di
scrivere nella cartella del grafo in uso (il motore la legge mentre serve le
richieste): con lo stesso PBF esce con **2**. Ma dopo una modifica a `prepare/` il
dato e' lo stesso e a cambiare e' il codice del pre-passo, per cui serve ricostruire
lo stesso. Lo si chiede in modo esplicito:

```bash
docker build -t wm-routing-prepare prepare/     # PRIMA: senza, il build gira col codice vecchio, in silenzio
WM_REBUILD_SAME_DATA=1 bash tools/build-graph.sh /data/wm-tiles/sources/italia.osm.pbf /data/wm-routing/terrain.pmtiles
```

Il grafo nuovo va in una cartella con un nome diverso, `<data>-r<ora della build>`
(per esempio `2026-11-20T100000Z-r20261121T192537Z`); quello in uso non si tocca. Lo
`stamp.json` dice sempre la data vera del dato OSM. Controllo e scambio sono quelli
di sempre, e la pulizia finale tiene il grafo nuovo e quello che era in uso. Senza
`WM_REBUILD_SAME_DATA=1` il comportamento non cambia, e il messaggio del rifiuto
rimanda a questo modo. `check-data.sh` (cron) non lo usa mai: ricostruisce solo se il
dato cambia.

Una sola build per volta: `build-graph.sh` prende un lock su
`/var/lib/wm-routing/grafi/.build.lock` e, se e' gia' preso (per esempio dal cron di
notte), esce con **75** senza toccare niente, come per gli altri rinvii. Si rilancia a
build finita.

Codici d'uscita: **2** dati mancanti o incoerenti (PBF senza data, rettangoli
che non tornano, tile senza quote), **3** controllo fallito (percorsi di prova
falliti, quote a zero, nodi calati oltre il 5%, riassunto del pre-passo monco o
assente), **75** rinviato (rigenerazione
di wm-tiles in corso, un'altra build del grafo in corso o memoria libera
insufficiente). In tutti e tre i casi il
grafo in uso resta quello di prima.

## Rilascio

Vale per ogni messa in produzione dopo la prima: codice nuovo, configurazione di
Caddy nuova, o tutte e due. **I due passi vanno in quest'ordine e nessuno dei due
e' opzionale.**

```bash
cd /srv/wm-routing && git pull &&
# 1. PRIMA Caddy. Lo script riscrive /etc/caddy/siti/routing.caddy da zero ed e'
#    la sola fonte di quel file: matcher delle rotte interne e blocco /mcp
#    compresi. Non lo rilancia nessun altro: ne' build-graph.sh, ne'
#    check-data.sh, ne' `docker compose up`. Saltarlo lascia sul server la
#    configurazione vecchia, e una rotta interna nuova nasce pubblica.
#    I comandi sono legati da && perche' il blocco si incolla intero: se lo script
#    esce con errore, il deploy del gateway non parte.
DOMINIO=routing.maphub.it bash infra/pubblica-routing.sh &&
# 2. POI il gateway.
source tools/bbox.sh && docker compose up -d --build gateway &&
bash tools/log-check.sh
```

**Perche' Caddy per primo.** Fra i due comandi c'e' una finestra in cui le due
parti non sono allineate, e l'errore non e' simmetrico. Caddy per primo: in
quella finestra una rotta interna nuova riceve `404` da Caddy mentre il gateway
non la serve ancora, e un `404` su una rotta che non esiste non fa male a
nessuno. Gateway per primo: la rotta esiste e non e' protetta, quindi per tutta
la durata del riavvio e' raggiungibile da internet.

Lo script si controlla da solo: dopo il reload chiede `/v1/version` e verifica
che ognuno dei percorsi di `INTERNI` (`poi`, `places` e `areas`, con e senza slash
finale) risponda `404` da internet. Se
non e' cosi' esce con errore e il rilascio si ferma, ma la configurazione **resta
pubblicata**: il file e' gia' scritto e Caddy gia' ricaricato, e lo script non
ripristina niente. Per tornare indietro si rilancia lo script della release
precedente. La verifica a mano, piu' larga, e' in
«[La rotta dei POI resta interna](#la-rotta-dei-poi-resta-interna)».

## Le rotte per rettangolo

`GET /v1/:shard/places` e `GET /v1/:shard/areas` rispondono a «quali paesi e quali
zone stanno qui», cosa che `poi` (un raggio attorno a un punto) non sa dire. Il
rettangolo e' `bbox=ovest,sud,est,nord`, in gradi, ed e' in query string: non va in
nessun log. Con la credenziale spenta gli esempi che seguono funzionano cosi' come
sono, senza intestazione (stato e accensione: «La credenziale delle rotte dei dati»).
Come `poi`, sono percorsi interni di `infra/pubblica-routing.sh`: servono allo stesso
backend di Walkiria, sulla stessa macchina, e da internet Caddy risponde `404`. Gli
esempi si lanciano quindi dal server (`ssh wm-tiles`), direttamente sul gateway.

```bash
D=http://127.0.0.1:8991
# paesi e citta' dentro il rettangolo (kinds facoltativo; limit 200 di default, tetto 2000)
curl -s "$D/v1/walkiria/places?bbox=10.4,43.7,10.6,43.8&kinds=city,town&limit=50"
# le regioni che intersecano il rettangolo (kind obbligatorio: region o zone; bbox facoltativo)
curl -s "$D/v1/walkiria/areas?kind=region&bbox=10.4,43.7,10.6,43.8"
```

`places` risponde `{"places":[{"name","kind","lonLat":[lon,lat],"ele","osmId"}]}`,
con `"troncato":true` se c'era altro oltre `limit`. `areas` risponde
`{"areas":[{"name","kind","bbox":[w,s,e,n],"osmType","osmId"}]}`, senza taglio.
Un risultato vuoto porta `vuoto` col motivo. Un `bbox` mal scritto da `400
{"stato":"bbox_non_valido"}`, un `kind` diverso da `region` e `zone` su `/areas`
da `400 {"stato":"kind_non_valido"}`.

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

`GET /v1/:shard/poi`, `/places` e `/areas` servono il backend di Walkiria, che gira sulla stessa macchina e
raggiunge il gateway dalla rete interna (`127.0.0.1:8991`). **Caddy non deve
pubblicarla**, e non va fatto a mano: `infra/pubblica-routing.sh` genera
`/etc/caddy/siti/routing.caddy` con la regola `@interne path $INTERNI` +
`respond @interne 404` prima del `reverse_proxy`. `INTERNI` e' una variabile sola,
in cima allo script (oggi `poi`, `places` e `areas`, ognuno anche con lo slash
finale, che Express serve): la leggono sia la regola sia il ciclo che alla fine dello script
prova il 404, quindi un percorso interno in piu' si aggiunge li' e in nessun altro
punto. La prova non puo' pero' accorgersi di un percorso che manca dall'elenco: chi
aggiunge al gateway una rotta destinata solo al backend deve metterla in `INTERNI`
nello stesso cambiamento, altrimenti nasce pubblica e lo script dice ok. Una regola scritta a mano sul server
verrebbe cancellata al rilancio dello script, quindi la protezione sta nello script.
Lo stesso vale per tutto il resto di quel file, blocco `/mcp` compreso: lo script lo
riscrive da zero ed e' la sua sola fonte (vedi «Rilascio» e `infra/mcp.md`).

Verifica dopo ogni deploy o rilancio dello script: e' quella che dimostra che la
protezione c'e' davvero. Vanno controllate **tutte e due le direzioni** nello stesso
momento: che la regola blocchi le rotte interne, e che non blocchi nient'altro. Il secondo
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
# le rotte interne non devono esistere: atteso "404 0" (codice e byte scaricati).
# Il 404 di Caddy non ha corpo; il 404 del gateway porta un JSON di una trentina
# di byte. Senza la dimensione i due sarebbero indistinguibili, e se un domani lo
# shard walkiria sparisse la verifica direbbe "protetta" anche senza matcher.
curl -s -o /dev/null -w 'poi:         %{http_code} %{size_download}B\n' -H "$A" "$D/v1/walkiria/poi?lon=10.5&lat=43.75"
# con lo slash finale: atteso "404 0" (senza, la regola sarebbe aggirata da Express)
curl -s -o /dev/null -w 'poi/:        %{http_code} %{size_download}B\n' -H "$A" "$D/v1/walkiria/poi/?lon=10.5&lat=43.75"
# le altre due rotte interne: atteso "404 0" anche per loro (lo script prova pure le forme con slash)
curl -s -o /dev/null -w 'places:      %{http_code} %{size_download}B\n' -H "$A" "$D/v1/walkiria/places?bbox=10.4,43.7,10.6,43.8"
curl -s -o /dev/null -w 'areas:       %{http_code} %{size_download}B\n' -H "$A" "$D/v1/walkiria/areas?kind=region&bbox=10.4,43.7,10.6,43.8"
# il resto deve passare: atteso 200 con un corpo non vuoto, entrambe
curl -s -o /dev/null -w 'route:       %{http_code} %{size_download}B\n' "$D/v1/walkiria/route" -H "$A" -H 'Content-Type: application/json' \
  -d '{"profile":"escursionista","points":[[10.30595,43.94908],[10.30479,43.99193]]}'
curl -s -o /dev/null -w 'version:     %{http_code} %{size_download}B\n' "$D/v1/version"
```

**Secondo blocco, sul server** (`ssh wm-tiles`), direttamente sul gateway senza passare
da Caddy: le rotte devono funzionare, altrimenti Walkiria non ha i POI ne' i paesi.

```bash
# anche qui l'intestazione non cambia l'esito finche' il gateway non chiede la
# credenziale (vedi «La credenziale delle rotte dei dati»). Resta scritta: e' la
# stessa chiamata da rilanciare col token vero il giorno in cui sara' accesa
curl -s -o /dev/null -w 'poi interna: %{http_code} %{size_download}B\n' \
  -H "Authorization: Bearer $WM_V1_TOKEN" \
  'http://127.0.0.1:8991/v1/walkiria/poi?lon=10.5&lat=43.75'
curl -s -o /dev/null -w 'places interna: %{http_code} %{size_download}B\n' \
  -H "Authorization: Bearer $WM_V1_TOKEN" \
  'http://127.0.0.1:8991/v1/walkiria/places?bbox=10.4,43.7,10.6,43.8'
curl -s -o /dev/null -w 'areas interna: %{http_code} %{size_download}B\n' \
  -H "Authorization: Bearer $WM_V1_TOKEN" \
  'http://127.0.0.1:8991/v1/walkiria/areas?kind=region&bbox=10.4,43.7,10.6,43.8'
```

Come si leggono gli esiti:

| Esito esterno su `poi`, `places`, `areas` (e `poi/`) | Cosa vuol dire |
|---|---|
| `404 0B` | il 404 e' di Caddy: la protezione c'e' |
| `404` con un corpo | risponde il gateway, quindi la richiesta e' passata: il matcher non c'e' |
| `200` | la rotta e' esposta |

Se le chiamate esterne alle rotte interne non danno `404 0B`, la rotta non e' protetta: rilanciare
`infra/pubblica-routing.sh` (vedi «Rilascio») e ripetere la verifica. Se `route` o
`version` non rispondono `200` il matcher e' troppo largo: correggere lo script e
rilanciarlo subito. Se la chiamata interna non risponde `200`, il problema e' il
gateway, non Caddy.

## La credenziale delle rotte dei dati

Quello che segue e' lo stato al **2026-11-21**. Per lo stato di adesso non
fidarti di questa pagina: chiedilo al servizio, col comando qui sotto. Chi
accende la credenziale riscrive questa sezione **e** i commenti dei due blocchi
di verifica delle rotte interne, qui sopra.

La prova, da fare sul server (`ssh wm-tiles`), e' una richiesta a una rotta dei
dati **senza** intestazione. Non c'e' nessun segreto in gioco:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8991/v1/walkiria/route
```

Come si legge l'esito, in tre casi distinti:

| Esito | Cosa vuol dire |
|---|---|
| `401` | credenziale **accesa** |
| `200`, `400` o `429`, e nessun altro codice | rotte **aperte**: il gateway ha servito una richiesta che nessuno ha autorizzato. `400` e' lui che si lamenta del corpo, `429` il limite di richieste |
| qualunque altro codice: `000`, `5xx`, `404`, `403`... | **la prova non ha misurato niente**: il gateway non ha risposto (giu', in riavvio, porta sbagliata, oppure un 502/503 di Caddy), o la richiesta e' stata fermata prima della credenziale (un `404` puo' essere uno shard sconosciuto). Rifare la prova, non concludere |

Il terzo caso non dice «aperte»: dice che non si sa. Lo stesso comando vale dal
dominio pubblico (`https://routing.maphub.it/v1/walkiria/route`), che e' come e'
stato misurato lo stato scritto qui: `400`, non `401`.

Al 2026-11-21, quindi, **le rotte `/v1/<shard>/*` sono aperte** a chiunque
raggiunga il gateway: da internet tutto tranne `/v1/*/poi`, `/v1/*/places` e `/v1/*/areas`, che ferma Caddy
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
parte lo stesso e si limita ad avvisare (`gateway/src/server.js:38-39`, riga
`ATTENZIONE: WM_V1_TOKEN assente, le rotte /v1 sono aperte a chiunque`). E'
voluto, perche' sul Mac si lavora senza segreti. L'avviso nel log e' un indizio
in piu', non una prova: **zero righe non vuol dire niente da solo**. Un gateway
piu' vecchio del commit che ha introdotto il controllo non stampa quell'avviso e
ha le rotte del tutto aperte; un `grep` sull'avviso nei log non trova niente
anche quando a fallire e' il comando che i log li legge, perche' l'errore non
passa nella pipe; e il gateway scrive una riga per richiesta, quindi con la
rotazione dei log la riga d'avvio sparisce da sola. L'esito del `curl` qui sopra invece misura il comportamento, e
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
  chiamate, `route`, `poi`, `rejoin`, `profiles` e `version` (`places` e `areas` il client non le chiama
ancora, ma la credenziale vale anche per loro). Serve
  `WM_ROUTING_TOKEN` nel suo `.env`, con lo stesso valore di `WM_V1_TOKEN` di
  qui; senza, il token resta nullo, l'intestazione non parte e Walkiria resta
  senza POI e senza percorsi. In locale, con il tunnel, va impostata anche
  `WM_ROUTING_POI_URL`, che e' un'altra faccenda ma si incontra nello stesso
  momento. Nota per l'altro repo: `.env.example:92` e `server/src/config.ts:52`
  dicono ancora che il gateway non ha autenticazione: vero oggi, da aggiornare
  li' il giorno dell'accensione.
- **La sequenza di accensione, e come si passa il token allo script.**
  `infra/pubblica-routing.sh` misura il gateway che e' in piedi in quel momento,
  non quello che stai per mettere, e nel «Rilascio» gira **prima** del deploy del
  gateway. Il giorno dell'accensione i passi sono tre, in quest'ordine:
  1. pubblicare **senza** `WM_V1_TOKEN`: il gateway in piedi e' ancora quello
     vecchio, che il token non lo chiede, e la prova torna «aperte» come atteso.
     Questo vale solo se e' vero: se il gateway in piedi ha gia' il token (passo
     2 gia' fatto, o deploy a meta'), il passo 1 si ferma per disaccordo, e si
     salta direttamente al 3;
  2. deployare il gateway **con** `WM_V1_TOKEN` nel suo ambiente;
  3. pubblicare di nuovo, questa volta **con** il token: ora la prova pretende
     `401` e un token di almeno 32 caratteri.

  Passando il token al primo passo, il gateway vecchio risponde `400` e lo script
  si ferma per disaccordo: la procedura non si completerebbe mai. Da li' in poi
  `WM_V1_TOKEN` va passato a **ogni** pubblicazione, altrimenti lo script trova
  un gateway che risponde `401` con il token assente e fallisce per lo stesso
  motivo. Quello che non va fatto e' scrivere il **valore** del token su una
  riga di comando, `ssh` compreso: finirebbe nella lista dei processi del server
  (`ps`). Va letto da un file sul server, e la lettura la fa la shell del
  server, dove il valore viaggia nell'ambiente del processo e non negli argomenti
  di nessun comando. Con `ssh` si puo' usare, a patto che l'espansione sia dentro
  gli apici (`ssh wm-tiles 'WM_V1_TOKEN=$(cat /root/wm-v1-token) DOMINIO=... bash -s'
  < infra/pubblica-routing.sh`); oppure si lancia dal server, come nel
  «Rilascio»:
  `WM_V1_TOKEN=$(cat /root/wm-v1-token) DOMINIO=routing.maphub.it bash infra/pubblica-routing.sh`.
  Il file si crea con proprietario root e permessi `600`, prima di scriverci
  dentro: `install -m 600 -o root /dev/null /root/wm-v1-token`, poi il valore con
  un editor (non con `echo`, che lo lascerebbe nella cronologia della shell). Il
  percorso e' un esempio, il file non esiste ancora.
- **Il connettore MCP invece e' gia' a posto.** I suoi tool escono dal processo e
  rientrano da `POST /v1/mcp/route`: l'intestazione la mette
  `gateway/src/mcp/v1-auth.js`, purche' il processo abbia `WM_V1_TOKEN`
  nell'ambiente (lo passa il compose).

## Spegnimento del GraphHopper di produzione

Criterio (overview): meno di 50 richieste al giorno dalle app per 30 giorni di
fila, senza contare i bot ne' la preview di wm-routing, che lo usa come termine
di confronto. Il conteggio si fa sul server di `graphhopper.webmapp.it`, senza
query string, quindi senza coordinate.

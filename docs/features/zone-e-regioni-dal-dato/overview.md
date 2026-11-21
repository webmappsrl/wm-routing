> Stato: chiusa il 2026-11-21

# Le zone e le regioni dal dato

## Cosa cambia

Il gateway comincia a rispondere a due domande a cui prima non sapeva rispondere:
**quali sono le regioni d'Italia, con il loro bbox**, e **quali zone
— massicci, catene, valli, parchi — esistono in un bbox**.

E la tabella dei POI smette di ignorare le citta': prima conosceva Calci e Buti
ma non Pisa, Lucca, Firenze. Il filtro ora le include; nel dato in produzione
compariranno quando l'enrich sara' rifatto (vedi «Rischi»).

Chi chiama smette di dover tenere una propria lista di regioni scritta a mano
e smette di dover indovinare dove sia una zona.

## Perche'

Walkiria sta riprogettando il modo in cui capisce di quale posto si parla.
La direzione decisa e': **i luoghi su cui si calcola un giro e i luoghi che si
nominano devono venire dalla stessa fonte**, cioe' da questi dati. Oggi i nomi
arrivano da un geocoder esterno, che e' una fonte diversa da quella su cui il
motore calcola, e le differenze fra le due costano errori silenziosi.

Tre buchi misurati il 2026-11-21 sul gateway vero (shard `walkiria`, dati OSM
del 2026-10-20) e su OpenStreetMap:

- **le citta' non ci sono.** Sonda di 2 km sul centro: Calci, Vicopisano e
  Barga rispondono col loro nome; Pisa, Lucca, Firenze, Volterra e San Giuliano
  Terme no. I `kind` restituiti sono `village hamlet locality peak saddle spring
  drinking_water viewpoint fountain shelter`: `city` e `town` non ci sono
  affatto. Il commento sopra il filtro dice gia' «abitati»: e' una svista;
- **le zone non ci sono.** In Italia OpenStreetMap ha **285 `place=region`**
  (Alpi Cozie, Alpi del Gran Paradiso, Alpi Orobie, Alpi Feltrine…), ma 203 sono
  relation e 65 way: il pre-passo legge solo nodi, quindi ne vedrebbe 17;
- **le regioni non ci sono.** Tutte e venti esistono come relation
  (`boundary=administrative`, `admin_level=4`, `ISO3166-2=IT-*`), e nessuna e'
  un nodo.

## Punto di partenza

`prepare/enrich.py` riempie la tabella `poi` con `class Pois`, un
`osmium.SimpleHandler` che implementa il solo metodo `node`. Il filtro e' in due
costanti: `POI_KINDS` (coppie tag/valore) e `POI_PLACES`, riga 45, oggi
`{"village", "hamlet", "locality"}`.

Il gateway espone `GET /v1/:shard/poi?lon&lat&radiusM`, con il raggio limitato a
2000 m, e `GET /v1/version`, che dichiara il bbox coperto.

## Requisiti

- <a id="r1"></a>**R1** — Il gateway risponde con **i luoghi abitati che stanno dentro un
  bbox dato**, citta' e paesi insieme: una chiamata, non una serie di sondaggi attorno
  a punti. Oggi Pisa, Lucca, Firenze e Volterra non compaiono da nessuna parte.
  - Verifica: [bbox-route.test.js](../../../gateway/test/bbox-route.test.js) › `/places: kinds separati da virgola filtrano per tipo` — con `kinds=city,town` torna un paese e una citta' in una chiamata sola, su una base dati costruita nel test
  - Verifica: [bbox-search.test.js](../../../gateway/test/bbox-search.test.js) › `con kinds city e town lascia outside locality e peak`
  - Verifica: [test_enrich.py](../../../prepare/tests/test_enrich.py) › `test_poi_table` — `place=city` e `place=town` entrano nella tabella `poi` (nel container: `docker run --rm -v "$PWD/prepare":/prepare -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q`)
  - Verifica: a mano — Claude, 2026-11-21: `enrich.py` sul ritaglio `data/pisa.osm.pbf` e poi `searchPlacesInBbox` con `kinds: ['city','town']` sul bbox `10.2,43.6,10.9,44.1` danno 26 luoghi, fra cui Pisa e Lucca (`city`) e San Giuliano Terme (`town`); Volterra e' `town` nella tabella; Firenze sta fuori dal ritaglio, quindi non provata. Sul dato nazionale in produzione serve ancora l'enrich
- <a id="r2"></a>**R2** — Il gateway risponde con **l'elenco delle regioni che il dato
  contiene**, ciascuna col proprio nome come sta nel dato e col proprio bbox. «Che il
  dato contiene» e non «le venti»: sull'area di prova del Mac le regioni sono zero —
  misurato il 2026-11-21, nella cella di Pisa non esiste nessuna relation
  `admin_level=4` — e un requisito che non si puo' vedere fallire dove si lavora non e'
  un requisito.
  - Verifica: [bbox-search.test.js](../../../gateway/test/bbox-search.test.js) › `kind region senza bbox elenca tutte le regioni, ognuna col proprio bbox`
  - Verifica: [bbox-route.test.js](../../../gateway/test/bbox-route.test.js) › `/areas: senza bbox tutte le aree di quel tipo`
  - Verifica: [test_enrich.py](../../../prepare/tests/test_enrich.py) › `test_area_regione_amministrativa` — la fixture ha una regione (`admin_level=4`), cosi' il requisito si vede riuscire dove si lavora; sul ritaglio di Pisa le regioni restano zero (misura del 2026-11-21: `areas_built` vuoto e tabella `area` vuota)
- <a id="r3"></a>**R3** — Il gateway risponde con **le zone che stanno dentro un
  bbox dato**, ciascuna col proprio nome e col proprio bbox.
  - Verifica: [bbox-search.test.js](../../../gateway/test/bbox-search.test.js) › `con un bbox restituisce le aree che lo intersecano, non solo le contenute` — con `kind: 'zone'` tornano le zone col proprio nome e bbox. «Dentro un bbox» e' realizzato come «interseca»: una zona piu' grande del bbox torna, vedi le note
  - Verifica: [bbox-route.test.js](../../../gateway/test/bbox-route.test.js) › `/areas: 200 con le aree del tipo che intersecano il bbox` — la rotta, provata con `kind=region`; la rotta con `kind=zone` non ha un test suo
  - Verifica: [test_enrich.py](../../../prepare/tests/test_enrich.py) › `test_area_table` — una `place=region` entra in tabella con `kind` `zone`, nome e bbox
- <a id="r7"></a>**R7** — Chi chiede **sceglie i tipi** che gli interessano, e il numero
  dei risultati e' un limite dichiarato da chi chiama, non l'effetto collaterale di un
  ordinamento per distanza. Misurato il 2026-11-21 sull'endpoint di oggi: una chiamata
  sulla cima del Monte Serra restituisce **gli stessi venti risultati con raggio 2 km, 5 km
  e 20 km** — i venti piu' vicini, tutti entro 1276 m, tutti `locality` e `peak`, **nessun
  paese**. Le `locality` sono quattro volte i paesi e ne occupano il posto.
  - Verifica: [bbox-route.test.js](../../../gateway/test/bbox-route.test.js) › `/places: limit in query string taglia e dichiara il taglio` — su `/places` i tipi li sceglie chi chiama (`kinds`) e il numero e' `limit`, con `troncato: true` se c'era altro
  - Verifica: [bbox-route.test.js](../../../gateway/test/bbox-route.test.js) › `/places: il default di limit e 200, il tetto 2000`
  - Verifica: [bbox-search.test.js](../../../gateway/test/bbox-search.test.js) › `con esattamente limit righe non dichiara il taglio` — il taglio dichiarato non scatta a vuoto
  - Verifica: a mano — Claude, 2026-11-21: il requisito vale per `/places` e non per `/areas`. `makeAreasHandler` in `gateway/src/bbox-handler.js` non legge `limit` e `searchAreasInBbox` non ha `limit` nella query: la risposta e' illimitata, ed e' piccola solo perche' il dato e' piccolo (circa trecento oggetti, vedi «Rischi»), non per contratto. Nessun test lo prova, perche' non c'e' niente da provare
- <a id="r4"></a>**R4** — Una zona e una regione portano un **bbox**, non un
  punto: sono aree, e un'area ridotta al suo centro non serve a inquadrare
  niente. E' un vincolo di struttura, non un dettaglio di come si scrive.
  - Verifica: [bbox-search.test.js](../../../gateway/test/bbox-search.test.js) › `kind region senza bbox elenca tutte le regioni, ognuna col proprio bbox` — ogni area porta `bbox: [w, s, e, n]`, e la tabella `area` non ha una colonna per un punto
  - Verifica: [test_enrich.py](../../../prepare/tests/test_enrich.py) › `test_area_table` — il bbox in tabella contiene i nodi dell'anello
- <a id="r5"></a>**R5** — Le risposte nuove rispettano la regola del repo sui log:
  nessuna coordinata viene registrata.
  - Verifica: [bbox-route.test.js](../../../gateway/test/bbox-route.test.js) › `nessun bbox ne parametro nei log` — le chiamate a `/places` e `/areas` sono registrate (il test lo pretende) e nel log non compaiono ne' i numeri del bbox, ne' il valore di `limit`, ne' le parole `bbox`, `lon`, `lat`, `town`, `zone`
- <a id="r6"></a>**R6** — Il pre-passo continua a girare sull'area di prova del Mac
  (cella di Pisa) senza richiedere l'area intera.
  - Verifica: a mano — Claude, 2026-11-21: `docker run --rm --memory 4g -v "$PWD/prepare":/prepare:ro -v "$PWD/data":/in:ro -v <cartella>:/out wm-routing-prepare python enrich.py /in/pisa.osm.pbf /out/a.osm.pbf /out/ways.sqlite /out/tiles.txt` sul ritaglio di Pisa (61 MB) finisce in 46 secondi con 4 GB concessi e stampa il riassunto (`ways` 184273, `pois` 4716, `areas_seen` e `areas_built` vuoti). La suite del pre-passo (27 test, comando sopra) gira sulla fixture. Il picco di memoria non e' stato misurato

- <a id="r8"></a>**R8** — Il pre-passo **dichiara quante aree ha incontrato e quante ne ha
  assemblate**, per tipo. Un'area con membri fuori dal file non si assembla e osmium la
  scarta **senza dire niente**: misurato sull'area di prova, 88 relation `admin_level=8`
  nel file e **70 assemblate, 18 perse in silenzio**. In produzione lo stesso meccanismo
  morde sulle zone che sconfinano, che spariscono lasciando un elenco apparentemente
  completo.
  - Verifica: [test_enrich.py](../../../prepare/tests/test_enrich.py) › `test_area_incompleta_dichiarata` — una relation con un membro assente dal file e' vista e non assemblata, e il riassunto di `enrich()` lo dice per `kind` (`areas_seen` e `areas_built`)
  - Verifica: [gate-data.test.js](../../../gateway/test/gate-data.test.js) › `areas_seen pieno e areas_built vuoto o assente` — il controllo prima dello scambio ferma il caso in cui le aree c'erano e non si sono assemblate
  - Verifica: a mano — Claude, 2026-11-21: il conteggio e' provato sulla fixture. Le 88 relation `admin_level=8` del requisito non sono aree che il pre-passo raccoglie (solo `place=region` e `admin_level=4`), e sul ritaglio di Pisa il riassunto dichiara `areas_seen` vuoto: la perdita in silenzio sul dato nazionale non e' stata osservata

- <a id="r9"></a>**R9** — Le rotte dei dati di `/v1/` **vogliono una credenziale**, e senza
  rispondono con un errore esplicito. Oggi non ne vuole nessuna: verificato il 2026-11-21
  che `POST https://routing.maphub.it/v1/walkiria/route`, senza alcuna intestazione di
  autenticazione, arriva al gateway e risponde `400` sul contenuto della richiesta — non
  `401`, non `403`. `WM_LINK_KEY` e `WM_MCP_TOKEN` esistono ma coprono solo `/g/*` e
  `/mcp` (`gateway/src/server.js`, i due blocchi che leggono `WM_LINK_KEY` e
  `WM_MCP_TOKEN`), e il client di Walkiria (`packages/api-client/src/routing.ts`) manda
  solo `Content-Type: application/json`: l'intestazione `Authorization` la aggiunge il
  backend di Walkiria soltanto se `WM_ROUTING_TOKEN` e' impostato
  (`server/src/itinerary/routing.ts`).
  `GET /v1/version` resta aperta: dice il bbox coperto e la data del dato, niente
  altro, ed e' la prova di vita che `infra/pubblica-routing.sh` usa dopo il reload.
  - Verifica: [app.test.js](../../../gateway/test/app.test.js) › `con il token configurato, una richiesta senza intestazione riceve 401` — il meccanismo c'e': con `WM_V1_TOKEN` una richiesta senza intestazione riceve `401` e non arriva all'handler
  - Verifica: [app.test.js](../../../gateway/test/app.test.js) › `senza token configurato le rotte restano aperte` — e senza valore il meccanismo e' spento: e' lo stato di adesso
  - Verifica: [docker-compose.yml](../../../docker-compose.yml) › `WM_V1_TOKEN: "${WM_V1_TOKEN:-}"` — il valore predefinito e' vuoto
  - Verifica: a mano — Claude, 2026-11-21: la credenziale non e' accesa, per decisione del dev del 2026-11-21. `WM_V1_TOKEN` non ha valore nel `.env` locale, e `curl -s -o /dev/null -w '%{http_code}' -X POST https://routing.maphub.it/v1/walkiria/route` senza intestazione risponde `400` e non `401`. Con la credenziale accesa, `infra/pubblica-routing.sh` pretende il `401` e un token di almeno 32 caratteri. Il requisito e' soddisfatto dal codice e non dalla produzione: per accenderlo si imposta `WM_V1_TOKEN` (e `WM_ROUTING_TOKEN` nel backend di Walkiria), come dice il runbook
- <a id="r10"></a>**R10** — L'elenco dei percorsi che non devono uscire su internet
  **e' uno solo**, e la prova che li verifica lo legge da li'. Prima del lavoro l'elenco era
  scritto due volte a mano in `infra/pubblica-routing.sh`, nella regola di Caddy (riga 24)
  e nel ciclo che la verificava (riga 49), righe della versione `a7298f8`, e tutti e due
  nominavano `poi` e basta: un percorso nuovo sarebbe nato pubblico e lo script avrebbe
  continuato a dire «ok».
  - Verifica: [pubblica-routing.sh](../../../infra/pubblica-routing.sh) › `@interne path $INTERNI` — la regola di Caddy legge la variabile `INTERNI`, scritta una volta sola in cima allo script
  - Verifica: [pubblica-routing.sh](../../../infra/pubblica-routing.sh) › `for modello in $INTERNI` — e il ciclo che prova il 404 legge la stessa. Lo script gira come root sul server e non ha un test: la prova che morda su un percorso pubblico non e' stata vista qui
  - Verifica: [rotte-interne.test.js](../../../gateway/test/rotte-interne.test.js) › `ogni rotta /v1/:shard/* montata` — una rotta nuova in `app.js` che non sta ne' in `INTERNI` ne' fra le pubbliche dichiarate nel test fa fallire il test
- <a id="r11"></a>**R11** — Il controllo che precede lo scambio del grafo **guarda anche il
  dato del pre-passo**: che le tabelle attese esistano, e che il numero di righe di ognuna
  non sia crollato rispetto al grafo in uso, con la stessa soglia del 5% gia' applicata ai
  nodi. Prima del lavoro `tools/gate.mjs` verificava i percorsi di prova e i nodi di
  GraphHopper e non leggeva il dato del pre-passo: `extract_pois` e' fail-soft di proposito
  (`prepare/enrich.py`, la funzione `extract_pois`: «un errore qui logga e lascia il build
  valido, senza tabella»), quindi un'estrazione fallita produceva un grafo che superava il
  controllo e andava in uso **senza POI**, e Walkiria diceva «sul sentiero non risultano
  soste». Con le aree questo lavoro rende il passo piu' costoso, cioe' quel fallimento piu'
  probabile.
  - Verifica: [gate-data.test.js](../../../gateway/test/gate-data.test.js) › `pois a zero con un grafo in uso che li aveva ferma lo scambio` — il caso reale: l'estrazione fail-soft lascia `pois` a zero
  - Verifica: [gate-data.test.js](../../../gateway/test/gate-data.test.js) › `il confine del 5%: appena sotto passa, appena sopra blocca`
  - Verifica: [gate-data.test.js](../../../gateway/test/gate-data.test.js) › `ways mancante ferma lo scambio e il motivo lo nomina`
  - Verifica: a mano — Claude, 2026-11-21: il confronto e' provato sui riassunti, non su `ways.sqlite`; il collegamento (`tee` su `prepare.json` in `tools/build-graph.sh` che ha `set -euo pipefail`, i due argomenti in piu' passati a `tools/gate.mjs`) non ha un test e l'ho verificato leggendo il codice. Il controllo sulle aree scatta solo se `areas_seen` e' pieno, quindi sul ritaglio di Pisa non pretende aree

## Rischi

- **Una credenziale nuova si distribuisce prima di pretenderla.** Il giorno in cui il
  gateway comincia a rifiutare chi non la manda, il backend di Walkiria in produzione deve
  gia' averla nel proprio `.env`: altrimenti i giri smettono di funzionare tutti insieme.
  L'ordine e' obbligato — prima la chiave sulle due macchine, poi il gateway che la esige.
- **Chi chiama `/v1/` non e' solo Walkiria.** Vogliono la credenziale anche
  `tools/log-check.sh`, `tools/compare.mjs`, le prove di integrazione di Walkiria
  (`packages/api-client/test/integration/gateway.test.ts`) e i comandi scritti nel
  runbook. Un lavoro fatto a meta' lascia rossa la verifica dei log, che e' il controllo
  della regola sulle coordinate.
- **Il dato va ricostruito.** I requisiti che riguardano il dato ([R1](#r1),
  [R2](#r2), [R3](#r3), [R4](#r4), [R7](#r7), [R8](#r8)) non hanno effetto in
  produzione finche' l'enrich non viene rifatto su `italia.osm.pbf` sul server.
  E' un'operazione lunga, da fare in una finestra scelta. Finche' non avviene i
  luoghi restano quelli di prima, e le aree rispondono con un `vuoto` dichiarato
  («dati senza aree: grafo da rigenerare»).
- **Leggere le aree costa, ma il modo di non pagarlo e' gia' nel repo.** Il commento in
  `enrich()` dice che montare i poligoni sul file intero tiene in memoria tutte le vie
  («248 MB sulla cella di Pisa, decine di GB sul nazionale»), e per questo esiste gia'
  il passaggio con `osmium tags-filter` su un estratto. Le aree nuove **devono riusare
  quel passaggio**: l'estratto per `place=region` e `admin_level=4` e' di circa trecento
  oggetti. Verificato il 2026-11-21 che `tags-filter` **include gia' di default gli
  oggetti referenziati** (l'opzione esistente, `-R`, serve a escluderli): sull'area di
  prova, 79 aree amministrative nel sorgente e 79 dopo il filtro, nessuna persa.
- **Le zone non coprono tutto.** «Monti Pisani» in OpenStreetMap **non esiste**,
  in nessuna forma: verificato con interrogazione diretta su node, way e relation
  nel bbox giusto. Chi chiama non deve aspettarsi che ogni nome di massiccio
  si trovi qui.
- **Le `locality` sono rumore.** In un bbox di 16 km ce ne sono 74, e sono
  cose come «I sodi» o «La netta». Un endpoint che le restituisce senza
  distinguerle le fa pesare quanto un paese.

## Out of scope

- Il disegno nuovo di Walkiria che consuma queste risposte: e' un altro lavoro,
  in un altro repo.
- Togliere il geocoder esterno da Walkiria: potra' avvenire dopo, e non riguarda
  questo repo.
- I confini amministrativi sotto la regione (province, comuni): non servono a
  nessuno dei requisiti qui.
- Rifare l'enrich in produzione: e' un'operazione che decide chi gestisce la
  macchina, e ha i suoi tempi.

## Moduli toccati

Previsti:

- `prepare/enrich.py` — il filtro dei place, e la lettura delle aree
- `prepare/tests/test_enrich.py` — le prove del pre-passo
- lo schema della base dati del pre-passo — una tabella per le aree
- `gateway/` — gli endpoint nuovi e le loro prove
- `docs/` — il runbook di costruzione del grafo, se cambia
- `gateway/src/server.js` e `gateway/src/app.js` — la credenziale sulle rotte dei dati
- `infra/pubblica-routing.sh` — l'elenco unico dei percorsi interni e la prova che lo legge
- `tools/log-check.sh`, `tools/compare.mjs`, `docs/runbook.md` — chi chiama `/v1/`
- `tools/gate.mjs` e `tools/build-graph.sh` — il controllo del dato prima dello scambio

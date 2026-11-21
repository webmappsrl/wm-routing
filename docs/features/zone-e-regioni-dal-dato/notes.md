> Stato: chiusa il 2026-11-21

# Le zone e le regioni dal dato — note

## Impronta dell'overview approvata

impronta `ab09c2e36396cd5009935e366ae09aa1841d2d97` — `docs/features/zone-e-regioni-dal-dato/overview.md`, approvata il
2026-11-21 con i requisiti da `R1` a `R11`.

Si rilegge con `git cat-file -p ab09c2e36396cd5009935e366ae09aa1841d2d97`.

## Modifiche ai requisiti

### 2026-11-21 — La credenziale: due riferimenti che non erano piu' veri
- **Requisito:** [R9](overview.md#r9)
- **Effetto:** modificato
- **Decide:** agente
- **Motivo:** chiusura dei documenti. Il numero di riga di `server.js` (36-51) era slittato di undici righe con il lavoro, e il client di Walkiria non manda piu' «solo» `Content-Type`: il backend aggiunge `Authorization` se ha `WM_ROUTING_TOKEN`. Il requisito non cambia, e «Oggi non ne vuole nessuna» e' rimasto vero (richiesta senza intestazione a produzione, 2026-11-21: `400`).
- **Testo nuovo:**
  > Le rotte dei dati di `/v1/` **vogliono una credenziale**, e senza
  > rispondono con un errore esplicito. Oggi non ne vuole nessuna: verificato il 2026-11-21
  > che `POST https://routing.maphub.it/v1/walkiria/route`, senza alcuna intestazione di
  > autenticazione, arriva al gateway e risponde `400` sul contenuto della richiesta — non
  > `401`, non `403`. `WM_LINK_KEY` e `WM_MCP_TOKEN` esistono ma coprono solo `/g/*` e
  > `/mcp` (`gateway/src/server.js`, i due blocchi che leggono `WM_LINK_KEY` e
  > `WM_MCP_TOKEN`), e il client di Walkiria (`packages/api-client/src/routing.ts`) manda
  > solo `Content-Type: application/json`: l'intestazione `Authorization` la aggiunge il
  > backend di Walkiria soltanto se `WM_ROUTING_TOKEN` e' impostato
  > (`server/src/itinerary/routing.ts`).
  > `GET /v1/version` resta aperta: dice il bbox coperto e la data del dato, niente
  > altro, ed e' la prova di vita che `infra/pubblica-routing.sh` usa dopo il reload.

### 2026-11-21 — L'elenco dei percorsi interni: «oggi» diventa «prima del lavoro»
- **Requisito:** [R10](overview.md#r10)
- **Effetto:** modificato
- **Decide:** agente
- **Motivo:** chiusura dei documenti. Il requisito e' soddisfatto: l'elenco e' uno solo, `INTERNI`. La frase «Oggi l'elenco e' scritto due volte» era diventata falsa, e le righe 24 e 49 sono quelle della versione `a7298f8`.
- **Testo nuovo:**
  > L'elenco dei percorsi che non devono uscire su internet
  > **e' uno solo**, e la prova che li verifica lo legge da li'. Prima del lavoro l'elenco era
  > scritto due volte a mano in `infra/pubblica-routing.sh`, nella regola di Caddy (riga 24)
  > e nel ciclo che la verificava (riga 49), righe della versione `a7298f8`, e tutti e due
  > nominavano `poi` e basta: un percorso nuovo sarebbe nato pubblico e lo script avrebbe
  > continuato a dire «ok».

### 2026-11-21 — Il controllo del dato: «oggi» diventa «prima del lavoro»
- **Requisito:** [R11](overview.md#r11)
- **Effetto:** modificato
- **Decide:** agente
- **Motivo:** chiusura dei documenti. Il requisito e' soddisfatto: `tools/gate.mjs` legge ora il riassunto del pre-passo. «Non legge `ways.sqlite`» resta vero, ma e' tolto dal requisito perche' non e' la sua misura, e `prepare/enrich.py:75-89` e' diventato un riferimento a `extract_pois`, perche' le righe sono slittate.
- **Testo nuovo:**
  > Il controllo che precede lo scambio del grafo **guarda anche il
  > dato del pre-passo**: che le tabelle attese esistano, e che il numero di righe di ognuna
  > non sia crollato rispetto al grafo in uso, con la stessa soglia del 5% gia' applicata ai
  > nodi. Prima del lavoro `tools/gate.mjs` verificava i percorsi di prova e i nodi di
  > GraphHopper e non leggeva il dato del pre-passo: `extract_pois` e' fail-soft di proposito
  > (`prepare/enrich.py`, la funzione `extract_pois`: «un errore qui logga e lascia il build
  > valido, senza tabella»), quindi un'estrazione fallita produceva un grafo che superava il
  > controllo e andava in uso **senza POI**, e Walkiria diceva «sul sentiero non risultano
  > soste». Con le aree questo lavoro rende il passo piu' costoso, cioe' quel fallimento piu'
  > probabile.

## Divergenze dal piano

### 2026-11-21 — Il modulo del controllo ha i nomi in inglese

Il piano chiamava `tools/gate-dati.mjs`, `confrontaDati` e `gateway/test/gate-dati.test.js`, e
il motivo `perche`. Nel codice sono `tools/gate-data.mjs`, `compareData`,
`gateway/test/gate-data.test.js` e `reason`. Stessa interfaccia, altri nomi.

### 2026-11-21 — Le aree si pretendono solo se il pre-passo ne ha viste

Il piano diceva che una chiave mancante o a zero ferma lo scambio, `areas_built` compreso. Sul
ritaglio di Pisa non ci sono ne' zone ne' regioni e `areas_built` e' vuoto per costruzione:
pretenderlo avrebbe fermato ogni build di prova. `compareData` lo pretende solo se `areas_seen`
e' pieno. Limite residuo, scritto nel commento del modulo: al primo build su una macchina senza
grafo in uso il controllo non distingue un estratto senza aree da un filtro rotto.

### 2026-11-21 — La classe delle aree conta anche way e relation

Il piano la voleva con il solo metodo `area`. `NamedAreas` ha anche `way` e `relation`, perche'
`areas_seen` conta gli oggetti com'erano nel file, e un'area che non si assembla non arriva mai
a `area`: senza quei due metodi la differenza con `areas_built` non si potrebbe misurare.

## Bug trovati

- **`places` e `areas` nascevano pubbliche.** Non stavano in `INTERNI`, da internet rispondevano
  a chiunque e lo script diceva «ok». Corretto in `fc28917`; `edac99e` aggiunge un test che
  legge `app.js` e pretende che ogni rotta sia interna o dichiarata pubblica.
- **Il runbook diceva cose false sulla credenziale**: che `/v1/<shard>/*` la voleva e che il
  valore stava nello `.env` del server (`edf87d9`), che il backend di Walkiria non sapeva
  mandare l'intestazione (`5565e56`), e che qualunque esito diverso da `401` voleva dire «aperte»
  (`ead3514`).
- **Un commento in `prepare/enrich.py` diceva che senza aree il pre-passo si ferma**, e non e'
  vero (`2766918`).

## Decisioni

- **«Dentro un bbox», per le aree, vale «interseca».** Una zona piu' grande del bbox torna, e
  il bordo in comune conta (`searchAreasInBbox`, deciso nel piano, Task 3). I luoghi invece
  sono puntuali: `between` su `lon` e `lat`.
- **`places` e `areas` sono interne, come `poi`.** Le legge il backend di Walkiria dalla stessa
  macchina; da internet rispondono `404` (decisione del dev, `fc28917`).
- **`/places` ha `limit` (default 200, tetto 2000) e `kinds`; `/areas` ha `kind` obbligatorio
  e `bbox` facoltativo, e nessun `limit`.**
- **`WM_V1_TOKEN` e' spento in locale e in produzione**, per decisione del dev del 2026-11-21.
  Il meccanismo c'e' ed e' provato; accenderlo vuol dire impostare la variabile sulle due
  macchine e `WM_ROUTING_TOKEN` nel backend di Walkiria.

- **La credenziale di `/v1` e' un token nell'intestazione `Authorization`, non una
  chiave in query string.** `WM_MCP_TOKEN` sta in query string perche' il
  connettore MCP non sa mandare intestazioni; qui chi chiama e' codice nostro, e
  una query string finisce nei log di chiunque stia in mezzo.
- **`WM_V1_TOKEN` assente lascia le rotte aperte** invece di impedire l'avvio: sul
  Mac il gateway deve partire senza segreti. Che quello stato non arrivi in
  produzione lo garantisce la prova in `infra/pubblica-routing.sh` (`R10`), non il
  codice del gateway.
- **La tabella `area` ha la chiave composta `(osm_type, osm_id)`.** In OSM un way
  e una relation possono avere lo stesso id; la tabella `poi` ha `osm_id` da solo
  e oggi non se ne accorge perche' legge solo nodi.
- **L'estrazione delle aree non e' fail-soft**, al contrario di `extract_pois`: un
  errore ferma il pre-passo. Il fail-soft dei POI resta com'e', e a renderlo
  visibile pensa il controllo prima dello scambio (`R11`).
- **Il controllo prima dello scambio confronta i riassunti JSON del pre-passo**, non
  `ways.sqlite`: `better-sqlite3` sta nelle dipendenze del gateway e `tools/` gira
  con il node nudo.

## Follow-up

- **`/areas` non ha un limite.** La risposta e' illimitata, e il requisito sul numero dichiarato
  da chi chiama vale solo per `/places`. Oggi e' innocuo perche' le aree sono circa trecento;
  se il dato crescesse serve un `limit` anche li'.
- **La rotta `/areas?kind=zone` non ha un test di rotta suo**: `bbox-route.test.js` la prova con
  `kind=region`, e il filtro per bbox sulle zone e' provato solo in `bbox-search.test.js`.
- **L'enrich in produzione non e' rifatto.** Finche' non lo e', Pisa, Lucca e le zone non
  compaiono nel dato vero: la prova e' sul ritaglio di Pisa e sulle fixture.

- Un rilievo della challenge e' stato smontato e non diventa lavoro: **tornare
  indietro non costa un secondo rebuild**. `tools/build-graph.sh` conserva il grafo
  che era in uso e cancella solo i piu' vecchi; il rollback e' rifare il symlink
  `corrente` e ricreare i container.

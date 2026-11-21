> Stato: da approvare

# Le zone e le regioni dal dato — piano

> **Per chi esegue:** usa `superpowers:subagent-driven-development` o
> `superpowers:executing-plans` per lavorare task per task. I passi hanno la
> casella `- [ ]` per segnare cosa e' fatto.

**Obiettivo:** il gateway risponde con i luoghi abitati, le zone e le regioni che
stanno dentro un bbox, letti dallo stesso dato su cui il motore calcola, e le rotte
dei dati vogliono una credenziale.

**Come:** il pre-passo smette di guardare solo i nodi — monta anche le aree, su un
estratto `osmium tags-filter` come gia' fa per ghiacciai e zone militari — e scrive
una tabella `area` in `ways.sqlite` con il bbox di ognuna. Il gateway aggiunge due
rotte che leggono per bbox invece che per raggio. Le rotte dei dati passano da un
controllo della credenziale, e l'elenco dei percorsi che non devono uscire su
internet diventa uno solo, letto sia da Caddy sia dalla prova.

**Stack:** Python 3 + pyosmium + shapely (pre-passo), Node 22 + Express 5 +
better-sqlite3 + vitest (gateway), bash + Caddy (pubblicazione).

**Overview:** [overview.md](overview.md) — i requisiti `R1`-`R11` si citano per
identificativo.

## Vincoli che valgono per tutti i task

- **Nessuna coordinata nei log** (`R5`): un log nuovo del gateway passa da
  `gateway/src/log.js`, e la query string non viene mai registrata.
- **Identificatori in inglese, commenti e documentazione in italiano** (CLAUDE.md).
- **Sul Mac solo l'area di prova** (`R6`): ogni prova gira sulla fixture
  `engine/tests/rete.opl` o su una base dati costruita nel test, mai sul nazionale.
- Test del pre-passo:
  `docker run --rm -v "$PWD/prepare":/prepare -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q`
- Test del gateway: `cd gateway && npm test`
- Un commit per task, sul branch `feature/zone-e-regioni-dal-dato`.

## Dove guardare durante la review

- **Un'area che sconfina dal file non si assembla**, e osmium la scarta senza dire
  niente: il conteggio di `R8` e' l'unico modo per accorgersene (Task 2).
- **Un bbox degenere o rovesciato** (`e < w`, quattro numeri uguali, tre numeri
  soli): deve essere un errore dichiarato, non una risposta vuota (Task 3).
- **Un bbox grande come l'Italia** su un dato nazionale: il limite dichiarato da chi
  chiama e' l'unica difesa, e senza limite la risposta sarebbe di decine di migliaia
  di righe (Task 3).
- **Un grafo vecchio senza la tabella `area`** non e' un errore: si dichiara, come
  gia' fa `searchPoiNearby` per la tabella `poi` (Task 3).
- **La credenziale assente dall'ambiente** non deve far partire il gateway in
  silenzio come se fosse protetto (Task 5).

---

### Task 1: citta' e paesi fra i POI

**Requisiti:** `R1` (la parte del dato).

**File:**
- Modifica: `prepare/enrich.py:45`
- Modifica: `engine/tests/rete.opl` — due nodi nuovi
- Test: `prepare/tests/test_enrich.py:102` (`test_poi_table`)

**Interfacce:**
- Consuma: niente.
- Produce: la tabella `poi` contiene anche i `kind` `city` e `town`.

- [ ] **Passo 1: aggiungi alla fixture due nodi con nome**, uno `place=city` e uno
      `place=town`, dentro il bbox della rete esistente (gli altri nodi stanno
      intorno a 10.50/43.75). La fixture e' in formato OPL, un oggetto per riga.

- [ ] **Passo 2: estendi `test_poi_table`** perche' chieda che i due nomi nuovi
      siano nella tabella con `kind` `city` e `town`, e aggiorna l'asserzione
      `names == {...}` che oggi fissa l'elenco completo a due soli nomi.

- [ ] **Passo 3: lancia il test, deve fallire** con i due nomi mancanti.

- [ ] **Passo 4: aggiungi `"city"` e `"town"` a `POI_PLACES`** (`prepare/enrich.py:45`).
      Il commento sopra dice gia' «abitati».

- [ ] **Passo 5: lancia il test, deve passare.**

- [ ] **Passo 6: commit** — `feat(poi): citta' e paesi fra i luoghi abitati`

---

### Task 2: le aree nel pre-passo

**Requisiti:** `R2`, `R3`, `R4`, `R6`, `R8`.

**File:**
- Modifica: `prepare/enrich.py` — una classe nuova accanto a `Areas` (riga 191) e il
  richiamo dentro `enrich()` (riga 372)
- Modifica: `engine/tests/rete.opl` — una relation `place=region` e una
  `boundary=administrative` + `admin_level=4`, entrambe assemblabili, piu' una terza
  con un membro che non esiste nel file
- Test: `prepare/tests/test_enrich.py`

**Interfacce:**
- Consuma: niente.
- Produce: in `ways.sqlite` la tabella
  `area (osm_type text, osm_id integer, name text, kind text, min_lon real, min_lat real, max_lon real, max_lat real, primary key (osm_type, osm_id))`,
  con `kind` `"region"` per `admin_level=4` e `"zone"` per `place=region`.
  Il riassunto di `enrich()` porta `areas_seen` e `areas_built`, due dizionari per `kind`.

La chiave e' composta perche' un `way` e una `relation` possono avere lo stesso id:
la tabella `poi` ha `osm_id` da solo e li confonderebbe.

- [ ] **Passo 1: scrivi i test**, in `prepare/tests/test_enrich.py`, sulla fixture
      gia' prodotta da `result`:
      - `test_area_table` — la relation `place=region` e' in tabella con
        `kind == "zone"`, il suo nome, e un bbox che contiene i nodi che la compongono
        (`min_lon < max_lon` e `min_lat < max_lat`, con i valori della fixture);
      - `test_area_regione_amministrativa` — la relation `admin_level=4` ha
        `kind == "region"`;
      - `test_area_osm_type_nella_chiave` — `osm_type` vale `"relation"`;
      - `test_area_incompleta_dichiarata` — `areas_seen` e `areas_built` differiscono
        di uno sul `kind` della relation con il membro mancante.

- [ ] **Passo 2: lancia i test, devono fallire** con `no such table: area`.

- [ ] **Passo 3: scrivi la classe che monta le aree** in `prepare/enrich.py`, sul
      modello di `Areas`: un `osmium.SimpleHandler` con il solo metodo `area`, che
      riconosce `place=region` e `boundary=administrative` + `admin_level=4`, prende
      il nome da `name` (senza nome l'area si salta, come per i POI), calcola il bbox
      dal multipoligono con `WKBFactory` + `shapely` e conta per `kind` quante ne ha
      incontrate e quante assemblate. Un poligono rotto si salta, come gia' fa
      `Areas` con `RuntimeError`.

- [ ] **Passo 4: richiamala dentro `enrich()`**, nello stesso blocco
      `tempfile.TemporaryDirectory` della riga 372, con un secondo
      `osmium tags-filter` su un estratto suo:
      `a/place=region a/boundary=administrative`. Un estratto separato da quello di
      ghiacciai e zone militari, perche' quel filtro e' gia' scritto e non va
      allargato senza bisogno. L'estrazione delle aree **non e' fail-soft**: un
      errore qui deve fermare il pre-passo, non lasciare un dato monco (il
      comportamento opposto a `extract_pois`, che il Task 7 rende visibile).

- [ ] **Passo 5: crea la tabella e scrivila**, accanto a `drop table if exists ways`
      (riga 389), e aggiungi `areas_seen` e `areas_built` al dizionario restituito
      da `enrich()` (riga 412).

- [ ] **Passo 6: lancia i test, devono passare.**

- [ ] **Passo 7: commit** — `feat(prepare): le aree con il loro bbox nella tabella area`

---

### Task 3: la ricerca per bbox

**Requisiti:** `R1`, `R2`, `R3`, `R7`.

**File:**
- Crea: `gateway/src/bbox-search.js`
- Crea: `gateway/test/bbox-search.test.js`

**Interfacce:**
- Consuma: la tabella `area` del Task 2 e la tabella `poi`.
- Produce, su una connessione `better-sqlite3` gia' aperta in sola lettura (la apre e
  la chiude chi chiama, come `searchPoiNearby`):
  - `parseBbox(testo) -> {bbox: [w, s, e, n]} | {stato: 'bbox_non_valido'}`
  - `searchPlacesInBbox(db, {bbox, kinds, limit}) -> {places: [{name, kind, lonLat, ele, osmId}], troncato?: true} | {stato} | {places: [], vuoto}`
  - `searchAreasInBbox(db, {kind, bbox}) -> {areas: [{name, kind, bbox: [w, s, e, n], osmType, osmId}]} | {stato} | {areas: [], vuoto}`,
    dove `bbox` e' facoltativo: senza, l'elenco e' tutto quello che il dato contiene
    per quel `kind` (`R2`).

- [ ] **Passo 1: scrivi i test**, con una base dati costruita nel test come fa
      `gateway/test/poi-route.test.js` con `fixtureDb`:
      - `parseBbox` accetta `"10.4,43.6,10.6,43.8"` e rifiuta: tre numeri, un numero
        non numerico, `e <= w`, `n <= s`;
      - `searchPlacesInBbox` restituisce solo le righe dentro il bbox, e con
        `kinds: ['city', 'town']` lascia fuori `locality` e `peak`;
      - senza `kinds`, i tipi tornano tutti;
      - con `limit: 2` su tre righe dentro il bbox, la risposta ha due elementi e
        `troncato: true` — il taglio e' dichiarato, non silenzioso (`R7`);
      - `searchAreasInBbox` con `kind: 'region'` e senza bbox elenca tutte le
        regioni della tabella, e ognuna porta il proprio bbox (`R4`);
      - `searchAreasInBbox` con un bbox restituisce le aree che lo intersecano, non
        solo quelle interamente contenute;
      - base dati senza la tabella `area`: `{areas: [], vuoto: 'dati senza aree: grafo da rigenerare'}`,
        come fa `searchPoiNearby` per la tabella `poi` mancante.

- [ ] **Passo 2: lancia i test, devono fallire** — il modulo non esiste.

- [ ] **Passo 3: scrivi `gateway/src/bbox-search.js`.** La selezione e' un `between`
      su `lon` e `lat` per i luoghi; per le aree due rettangoli si intersecano quando
      `min_lon <= e` e `max_lon >= w` e `min_lat <= n` e `max_lat >= s` — quattro
      confronti nella query, non un calcolo geometrico: la tabella porta solo bbox.
      La tabella mancante si riconosce
      dal `catch` attorno al `prepare`, come in `gateway/src/mcp/poi.js:25`.

- [ ] **Passo 4: lancia i test, devono passare.**

- [ ] **Passo 5: commit** — `feat(gateway): ricerca di luoghi e aree dentro un bbox`

---

### Task 4: le rotte nuove

**Requisiti:** `R1`, `R2`, `R3`, `R4`, `R5`, `R7`.

**File:**
- Crea: `gateway/src/bbox-handler.js`
- Modifica: `gateway/src/app.js:54` — due registrazioni accanto a quella dei POI
- Modifica: `gateway/src/server.js:30` — i due handler passati a `createApp`
- Crea: `gateway/test/bbox-route.test.js`

**Interfacce:**
- Consuma: `parseBbox`, `searchPlacesInBbox`, `searchAreasInBbox` del Task 3.
- Produce: `makePlacesHandler({waysDb})` e `makeAreasHandler({waysDb})`, registrati
  come `handlers.places` su `GET /v1/:shard/places` e `handlers.areas` su
  `GET /v1/:shard/areas`.
  - `/places?bbox=w,s,e,n&kinds=city,town&limit=200` — `kinds` e' un elenco separato
    da virgole, facoltativo; `limit` ha come default 200 e come tetto 2000.
  - `/areas?kind=region|zone&bbox=w,s,e,n` — `kind` obbligatorio, `bbox` facoltativo.

- [ ] **Passo 1: scrivi i test**, sul modello di `gateway/test/poi-route.test.js`:
      200 con i luoghi dentro il bbox; `bbox` assente o malformato → 400 con
      `{stato: 'bbox_non_valido'}`; `kind` sconosciuto su `/areas` → 400; shard
      sconosciuto → 404 come le altre rotte `/v1`; e la prova dei log, copiata da
      quella in fondo a `poi-route.test.js`: la chiamata e' registrata ma nel log non
      compaiono ne' i numeri del bbox ne' le parole `bbox`, `lon`, `lat` (`R5`).

- [ ] **Passo 2: lancia i test, devono fallire** — 404 su entrambe le rotte.

- [ ] **Passo 3: scrivi gli handler** in `gateway/src/bbox-handler.js`, sullo stampo
      di `gateway/src/poi-handler.js`: leggono la query string, delegano al Task 3,
      e traducono lo `stato` in 400.

- [ ] **Passo 4: registrali** in `app.js` e in `server.js`.

- [ ] **Passo 5: lancia i test del gateway per intero** (`cd gateway && npm test`),
      devono passare.

- [ ] **Passo 6: commit** — `feat(gateway): rotte GET /v1/:shard/places e /areas`

---

### Task 5: la credenziale sulle rotte dei dati

**Requisiti:** `R9`.

**File:**
- Modifica: `gateway/src/app.js` — un controllo dentro il middleware `/v1/:shard`
  (riga 33), prima del limite di richieste
- Modifica: `gateway/src/server.js` — la variabile letta e passata a `createApp`
- Modifica: `gateway/test/app.test.js`
- Modifica: `tools/log-check.sh`, `tools/compare.mjs`, `docs/runbook.md`

**Interfacce:**
- Consuma: niente.
- Produce: `createApp({..., v1Token})`. Con `v1Token` definito, ogni richiesta a
  `/v1/:shard/*` senza `Authorization: Bearer <v1Token>` riceve `401` con
  `{stato: 'non_autorizzato'}`. Con `v1Token` indefinito le rotte restano aperte: e'
  lo sviluppo sul Mac. `GET /v1/version` non passa da questo controllo.
  La variabile d'ambiente e' `WM_V1_TOKEN`.

- [ ] **Passo 1: scrivi i test** in `gateway/test/app.test.js`: con il token
      configurato, una richiesta senza intestazione riceve 401 e **non** arriva
      all'handler (l'handler e' una spia che non deve essere chiamata); con
      l'intestazione giusta passa; con un token sbagliato riceve 401; `GET /v1/version`
      risponde 200 anche senza intestazione; senza token configurato tutto passa come
      oggi. Una prova in piu': il token non compare nei log.

- [ ] **Passo 2: lancia i test, devono fallire** — oggi passa tutto.

- [ ] **Passo 3: scrivi il controllo** in `app.js`, dentro il middleware
      `/v1/:shard` subito dopo la risposta a `OPTIONS` e prima del limite di
      richieste: una richiesta non autorizzata non deve consumare il secchio di
      qualcun altro. Il confronto fra token usa `crypto.timingSafeEqual` su lunghezze
      pari, come si confronta un segreto.

- [ ] **Passo 4: all'avvio, `server.js` dichiara come sta**: con `WM_V1_TOKEN`
      assente scrive sul log, in chiaro, che le rotte dei dati sono aperte. Il
      gateway parte lo stesso: e' il Mac. A impedire che quello stato arrivi in
      produzione ci pensa la prova del Task 6.

- [ ] **Passo 5: aggiorna chi chiama** — `tools/log-check.sh` e `tools/compare.mjs`
      mandano l'intestazione quando `WM_V1_TOKEN` e' nell'ambiente, e i comandi
      `curl` del `docs/runbook.md` la portano scritta.

- [ ] **Passo 6: lancia i test del gateway e `bash tools/log-check.sh`**, devono
      passare entrambi.

- [ ] **Passo 7: commit** — `feat(gateway): le rotte dei dati vogliono una credenziale`

---

### Task 6: un elenco solo dei percorsi interni

**Requisiti:** `R10`, `R9` (la prova).

**File:**
- Modifica: `infra/pubblica-routing.sh:19-24` e `:49-53`
- Modifica: `docs/runbook.md:103-106`

**Interfacce:**
- Consuma: la credenziale del Task 5.
- Produce: nello script una variabile sola, `INTERNI`, con i percorsi che Caddy deve
  nascondere; la regola di Caddy e il ciclo che la verifica la leggono entrambi.

- [ ] **Passo 1: raccogli i percorsi in `INTERNI`**, una variabile di shell con le
      due forme di ognuno (con e senza slash finale), e componi da li' sia la riga
      `@interne path ...` dell'heredoc sia il ciclo che prova il 404. Attenzione:
      l'heredoc e' senza apici, quindi `$INTERNI` si espande — ed e' quello che
      serve, mentre ogni altro `$` li' dentro va scritto `\$`.

- [ ] **Passo 2: aggiungi alla prova il caso della credenziale**: dopo il 404 sui
      percorsi interni, lo script chiede `POST /v1/walkiria/route` **senza**
      intestazione e pretende `401`. Se risponde altro, la configurazione non resta
      pubblicata. E' questa la prova che un gateway partito senza `WM_V1_TOKEN` non
      puo' restare esposto.

- [ ] **Passo 3: vedila fallire.** Sul server, prima del rilascio del Task 5, il
      gateway non chiede ancora niente e la prova deve dire di no. E' l'unico modo
      di sapere che morde davvero.

- [ ] **Passo 4: aggiorna il `docs/runbook.md`** nel punto in cui descrive la regola
      di Caddy e i comandi di verifica a mano.

- [ ] **Passo 5: commit** — `fix(infra): un elenco solo dei percorsi interni, e la prova lo legge`

---

### Task 7: il controllo guarda anche il dato del pre-passo

**Requisiti:** `R11`.

**File:**
- Crea: `tools/gate-dati.mjs`
- Modifica: `tools/gate.mjs` — il richiamo, accanto al controllo dei nodi
- Modifica: `tools/build-graph.sh:47` e `:66`
- Crea: `gateway/test/gate-dati.test.js`

**Interfacce:**
- Consuma: `areas_seen`, `areas_built` e `pois` del riassunto prodotto dal Task 2.
- Produce: `confrontaDati(nuovo, corrente) -> {ok: true} | {ok: false, perche: string}`,
  esportata da `tools/gate-dati.mjs`. I due argomenti sono i riassunti del pre-passo
  gia' decodificati, non percorsi di file. Le chiavi guardate sono `ways`, `pois` e
  `areas_built` (per `kind`). Una chiave mancante o a zero, oppure calata di piu' del
  5% rispetto al grafo in uso, ferma lo scambio. `corrente` indefinito (primo build):
  basta che le chiavi ci siano e non siano a zero.

`gate-dati.mjs` e' un modulo senza niente in cima che giri da solo, perche'
`tools/gate.mjs` esegue appena lo si importa e non si potrebbe provare. Il confronto
passa dai riassunti in JSON e non da `ways.sqlite`: `better-sqlite3` sta nelle
dipendenze del gateway, e `tools/` gira con il node nudo.

- [ ] **Passo 1: scrivi i test** in `gateway/test/gate-dati.test.js`, su due oggetti
      scritti nel test: `areas_built` senza il `kind` `region` che il corrente aveva
      → `ok: false`; `pois` calati dell'1% → `ok: true`; calati del 20% → `ok: false`
      con il nome della chiave nel motivo; `pois` a zero al primo build → `ok: false`;
      nessun corrente e chiavi piene → `ok: true`.

- [ ] **Passo 2: lancia i test, devono fallire** — il modulo non esiste.

- [ ] **Passo 3: scrivi `tools/gate-dati.mjs`.**

- [ ] **Passo 4: salva il riassunto accanto al grafo.** `enrich.py` lo stampa gia' in
      JSON su stdout (`prepare/enrich.py:422`): in `tools/build-graph.sh:47` quella
      riga diventa un `tee "$DIR/prepare.json"`, cosi' il riassunto resta nella
      cartella del grafo e il build successivo trovera' quello del grafo in uso in
      `$ROOT/corrente/prepare.json`.

- [ ] **Passo 5: richiama `confrontaDati` da `tools/gate.mjs`**, accanto al controllo
      dei nodi e con lo stesso stile di messaggio: il motivo per cui lo scambio si
      ferma si legge dal log del build. I due riassunti si leggono dai percorsi
      passati sulla riga di comando in `tools/build-graph.sh:66`; quello del corrente
      puo' non esistere, ed e' il primo build.

- [ ] **Passo 6: lancia i test, devono passare.**

- [ ] **Passo 7: commit** — `feat(build): lo scambio si ferma se il dato del pre-passo e' monco`

---

### Task 8: il runbook e il CLAUDE.md

**Requisiti:** nessuno nuovo — e' la chiusura.

**File:**
- Modifica: `docs/runbook.md`
- Modifica: `CLAUDE.md`

- [ ] **Passo 1: nel runbook**, le rotte nuove con un esempio di chiamata vera, e la
      riga sul rifacimento dell'enrich che ora produce anche la tabella `area`.

- [ ] **Passo 2: nel `CLAUDE.md`**, una riga sola nelle regole del repo:
      `WM_V1_TOKEN` e cosa succede senza. Non di piu': il resto sta nel runbook.

- [ ] **Passo 3: lancia tutti i controlli** — test del gateway, test del pre-passo,
      `bash tools/log-check.sh` — e riporta l'esito di ognuno.

- [ ] **Passo 4: commit** — `docs: le rotte per bbox e la credenziale di /v1`

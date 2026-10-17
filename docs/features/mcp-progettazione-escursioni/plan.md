# Servizio MCP di progettazione escursioni — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP server in Node dentro il gateway di wm-routing: tool `route` con risposta compatta e link firmato `/g/`, GPX generato dal server, transport stdio (locale) e streamable HTTP online con token, tool `poi_nearby` su tabella estratta dal pre-passo.

**Architecture:** i tool MCP sono un wrapper: chiamano il `/v1` del gateway (via HTTP da stdio; stesso contratto quando la rotta vivrà nel processo) e compattano la risposta per un LLM. I deliverable non passano dalle mani del modello: il link `/g/?t=<blob firmato>` e il GPX li genera il server; firma rotta → errore esplicito, data stamp cambiato → banner nella preview.

**Tech Stack:** Node 20 (container; in locale ≥18), express 5, `@modelcontextprotocol/sdk` (nuova dipendenza), better-sqlite3, vitest + supertest, Python/pyosmium nel pre-passo.

**Spec:** `docs/features/mcp-progettazione-escursioni/overview.md` (requisiti) e `docs/superpowers/specs/2026-10-17-mcp-progettazione-escursioni-design.md` (design).

## Global Constraints

- Nessuna coordinata nei log: ogni log nuovo passa da `gateway/src/log.js`; i blob e i token viaggiano in query string (mai loggata).
- `horse_rating` e il suo significato riciclato non escono da nessun tool.
- Identificatori wiki (`wikipedia`, `wikidata`) e basta: nessun contenuto wiki lato server.
- Segreti (`WM_LINK_KEY`, `WM_MCP_TOKEN`) solo in variabili d'ambiente, mai nella config versionata.
- La risposta grezza di `/v1` (geometria integrale) non arriva mai al modello.
- Documentazione e commenti in italiano, identificatori in inglese.
- I passi di commit sono istruzioni per il dev: nessun `git commit`/`push`/branch automatico.
- Ordine dei blocchi (deciso dal dev): 1) giro stdio completo, 2) rotta online, 3) POI.

## Review Focus

1. Link `/g/` con firma valida ma punti fuori dall'area corrente (grafo cambiato o richiesta nata altrove) → pagina che spiega, mai 500. (Test in Task 4.)
2. Tool `route` con input degeneri (meno di 2 punti, coordinate non numeriche, punti fuori area) → risposta d'errore chiara del tool, mai eccezione non gestita. (Test in Task 5.)
3. `/g/gpx` con motore giù o che rifiuta → errore esplicito con messaggio, mai file vuoto o troncato. (Test in Task 4.)
4. `/mcp` con token assente o sbagliato → 401 asciutto; con `WM_MCP_ENABLED` spento → 404; in entrambi i casi nessun dettaglio del token nei log. (Test in Task 7.)
5. `poi_nearby` su grafo con `ways.sqlite` vecchio (senza tabella `poi`) o zona senza POI → risposta vuota dichiarata («nessun POI qui» / «dati senza POI: rigenerare il grafo»), mai errore. (Test in Task 10.)

---

## Blocco 1 — giro completo in stdio

### Task 1: Link firmato (`link.js`)

**Files:**
- Create: `gateway/src/mcp/link.js`
- Test: `gateway/test/mcp-link.test.js`

**Interfaces:**
- Produces: `encodeLink({points, profile, stamp}, key) -> string` (blob base64url `payload.firma`, HMAC-SHA256 troncata a 16 byte, `node:crypto`); `decodeLink(blob, key) -> {points, profile, stamp}` oppure lancia `LinkError('firma_non_valida')`.

- [ ] **Step 1: scrivi i test che falliscono** in `gateway/test/mcp-link.test.js`:
  - `encodeLink` → `decodeLink` restituisce punti (2 decimali uguali a 5 cifre), profilo e stamp identici;
  - un blob con un carattere alterato → `LinkError` con `stato: 'firma_non_valida'`;
  - un blob troncato → stessa `LinkError`;
  - chiavi diverse in encode/decode → stessa `LinkError`.
- [ ] **Step 2: esegui** `cd gateway && npx vitest run test/mcp-link.test.js` — atteso: FAIL (modulo inesistente).
- [ ] **Step 3: implementa `link.js`** (JSON compatto nel payload: `{p, pr, d}`; coordinate a 5 decimali).
- [ ] **Step 4: esegui di nuovo** — atteso: PASS.
- [ ] **Step 5: commit (istruzione per il dev):** `feat(mcp-progettazione-escursioni): link firmato per i deliverable`

### Task 2: Compattazione della risposta (`compact.js`)

**Files:**
- Create: `gateway/src/mcp/compact.js`
- Test: `gateway/test/mcp-compact.test.js`

**Interfaces:**
- Consumes: la risposta JSON di `POST /v1/:shard/route` (campi verificati: `distanceM`, `ascendM`, `descendM`, `timeH`, `geometry`, `segments[]` con `ref/difficulty/osmWayId/...`, `waypoints[]`, `unknownShare`, `warning`, `snowWarning`, `offTrailPoints`, `connectors`, `suggerimento`).
- Produces: `compactRoute(v1Json) -> object` col formato dello spike (design, sezione spike): totali arrotondati, `tappe[]` cumulate, `sentieri[]` aggregati per `ref|difficulty|roadClass` con km, `avvisi{}`, `geometriaCampione` ≤ 25 punti `[lon,lat,quota]`. Mai i campi grezzi `geometry`/`segments`.

- [ ] **Step 1: fixture** — salva in `gateway/test/fixtures/v1-route.json` una risposta vera di `/v1/preview/route` (anello Calci dello spike) presa dal gateway locale.
- [ ] **Step 2: test che falliscono**: totali e ore DIN uguali alla fixture; `sentieri` ordinati per km decrescente e col ref `135` presente; `geometriaCampione.length <= 26`; nessuna chiave `geometry`/`segments` nell'output; nessuna occorrenza di `horse` in `JSON.stringify(output)`.
- [ ] **Step 3: esegui** `npx vitest run test/mcp-compact.test.js` — FAIL.
- [ ] **Step 4: implementa `compact.js`** (porta la logica dello script dello spike, descritto nel design).
- [ ] **Step 5: esegui** — PASS.
- [ ] **Step 6: commit:** `feat(mcp-progettazione-escursioni): risposta compatta per il modello`

### Task 3: GPX dal server (`gpx.js`)

**Files:**
- Create: `gateway/src/mcp/gpx.js`
- Test: `gateway/test/mcp-gpx.test.js`

**Interfaces:**
- Consumes: `{geometry, snapped}` dalla risposta `/v1` e `{points, profile}` dal blob.
- Produces: `toGpx({geometry, points, profile, stamp}) -> string` — GPX 1.1: `<trk>` con le quote, un `<wpt>` per punto richiesto, `<metadata>` con data dei dati e il warning del servizio. Specchia la logica client di `preview/preview.js:1275` (`toGpx`).

- [ ] **Step 1: test che falliscono**: output che inizia con `<?xml`; tanti `<trkpt>` quanti i punti della geometria; `<ele>` presenti; un `<wpt>` per punto; `<metadata>` contiene lo stamp.
- [ ] **Step 2: esegui** — FAIL. **Step 3: implementa.** **Step 4: esegui** — PASS.
- [ ] **Step 5: commit:** `feat(mcp-progettazione-escursioni): gpx generato dal server`

### Task 4: Rotta `/g/` (espansione, errore, GPX)

**Files:**
- Modify: `gateway/src/app.js` (nuovi handler opzionali, come `handlers.route`)
- Modify: `gateway/src/server.js` (composizione: chiave da `WM_LINK_KEY`)
- Test: `gateway/test/g-route.test.js`

**Interfaces:**
- Consumes: Task 1 (`decodeLink`), Task 3 (`toGpx`), `makeRouteCore` esistente (`gateway/src/route.js`) per ricalcolare dal blob.
- Produces: `GET /g/?t=<blob>` → 302 verso `/preview/?p=...&profilo=...&d=<stamp>`; firma rotta → 400 con pagina HTML «link alterato» (testo esatto: *«Questo link è stato alterato o troncato: non fidarti del giro che mostrerebbe. Fatti rimandare il link dall'assistente.»*); `GET /g/gpx?t=<blob>` → ricalcolo e GPX con `Content-Disposition: attachment`.

- [ ] **Step 1: test che falliscono** (supertest con engine finto, stile `test/route.test.js`): blob valido → 302 con `Location` che contiene `p=` e `d=`; blob alterato → 400 e corpo con «alterato»; `/g/gpx` valido → 200, `content-type` gpx, corpo con `<trk>`; `/g/gpx` con engine che risponde errore → 502 e messaggio, nessun `<gpx>`; blob con punti fuori bbox → 400 con «fuori dall'area» e l'area.
- [ ] **Step 2: esegui** `npx vitest run test/g-route.test.js` — FAIL.
- [ ] **Step 3: implementa** gli handler in un nuovo `gateway/src/mcp/g-route.js` montato da `server.js` (pattern di `/preview`), riusando `makeRouteCore`.
- [ ] **Step 4: esegui** — PASS, poi `npm test` intero — PASS.
- [ ] **Step 5: verifica dal vivo**: `curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:8991/g/?t=<blob di prova generato con node>'` → 302 (richiede `WM_LINK_KEY` nell'environment del compose: aggiungila a `docker-compose.yml` come variabile passante).
- [ ] **Step 6: commit:** `feat(mcp-progettazione-escursioni): rotta /g/ con firma, preview e gpx`

### Task 5: MCP server e transport stdio

**Files:**
- Create: `gateway/src/mcp/server.js` (tool e istruzioni), `gateway/src/mcp/stdio.js` (avvio)
- Modify: `gateway/package.json` (dipendenza `@modelcontextprotocol/sdk`, script `mcp`)
- Modify: `gateway/config/shards.json` (shard `mcp`: profili come `webmapp`, `origins: []`, `limits: true`, `maxPoints: 25`, rate come `preview`)
- Test: `gateway/test/mcp-server.test.js`

**Interfaces:**
- Consumes: Task 1, 2; il gateway HTTP (`WM_GATEWAY_URL`, default `http://127.0.0.1:8991`).
- Produces: tool MCP `route` — input `{points: [[lon,lat],...], profile}`, output: la risposta compatta di Task 2 più `linkPreview` e `linkGpx` (da Task 1) e `area` quando `/v1` rifiuta per fuori-area. Server instructions (testo in italiano, nel codice): disciplina anti-invenzione («ogni numero viene dai tool…»), uso dei profili, rimando ai tool web del client per le wiki, istruzione di riferire il fuori-area.

- [ ] **Step 1: test che falliscono** (handler del tool chiamato direttamente con `fetch` finto): risposta compatta con `linkPreview` che inizia con `/g/?t=`; input con 1 punto → errore `{stato: 'punti_insufficienti'}` senza eccezione; `/v1` che risponde 404 fuori-area → output con `avvisi.fuoriArea` e l'area; coordinate non numeriche → errore pulito.
- [ ] **Step 2: esegui** — FAIL. **Step 3: implementa** (SDK: `McpServer` + `StdioServerTransport`; il transport HTTP arriva nel Task 7 sullo stesso oggetto server). **Step 4: esegui** — PASS.
- [ ] **Step 5: prova vera in locale**: registra in Claude Code `claude mcp add wm-routing -- node <repo>/gateway/src/mcp/stdio.js` e chiedi un percorso sulla cella: il tool risponde, il link si apre, il GPX scende. Esito riportato al dev.
- [ ] **Step 6: commit:** `feat(mcp-progettazione-escursioni): mcp server con tool route, transport stdio`

### Task 6: Banner «dati cambiati» nella preview

**Files:**
- Modify: `preview/preview.js` (lettura del parametro `d`, confronto con lo stamp di `/v1/version` già caricato in `loadMeta`)
- Test: `gateway/scripts/preview-check.mjs` (aggiunta: apertura con `d` finto)

**Interfaces:**
- Consumes: il parametro `d` scritto dalla 302 di Task 4.
- Produces: banner visibile (riuso di `flash`/`#err` secondo lo stile della pagina) con testo esatto: *«I dati sono cambiati da quando questo giro è stato progettato: ricontrolla tempi e difficoltà.»* quando `d` esiste e differisce dallo stamp corrente; nessun banner quando coincide o manca.

- [ ] **Step 1: aggiungi alla pagina** la logica del confronto in `loadMeta` (3-5 righe).
- [ ] **Step 2: estendi `preview-check.mjs`**: apertura con `?d=1970-01-01T00:00:00Z&p=<due punti>` → il banner c'è; apertura senza `d` → non c'è.
- [ ] **Step 3: esegui** `cd gateway && node scripts/preview-check.mjs` — PASS; poi `node scripts/preview-ux-check.mjs` — PASS (non regredito).
- [ ] **Step 4: commit:** `feat(mcp-progettazione-escursioni): banner dati cambiati nella preview`

## Blocco 2 — rotta online

### Task 7: Transport streamable HTTP con token e interruttore

**Files:**
- Create: `gateway/src/mcp/http.js`
- Modify: `gateway/src/server.js` (mount se `WM_MCP_ENABLED=1`), `docker-compose.yml` (passare `WM_MCP_ENABLED`, `WM_MCP_TOKEN`, `WM_LINK_KEY`)
- Test: `gateway/test/mcp-http.test.js`

**Interfaces:**
- Consumes: lo stesso oggetto server MCP di Task 5 (`StreamableHTTPServerTransport` dell'SDK).
- Produces: `POST/GET /mcp?t=<WM_MCP_TOKEN>`; token assente/sbagliato → 401 `{stato: 'non_autorizzato'}`; `WM_MCP_ENABLED` diverso da `1` → la rotta non è montata (404); rate limit con `createRateLimiter` esistente; una riga di log per chiamata tool via `logEvent` (`route: '/mcp'`, nome tool, status, ms — mai parametri).

- [ ] **Step 1: test che falliscono** (supertest): senza token → 401; token giusto → handshake MCP risponde; con `WM_MCP_ENABLED=0` → 404; il log event (spy su `logEvent`) non contiene coordinate né il token.
- [ ] **Step 2: esegui** — FAIL. **Step 3: implementa.** **Step 4: esegui** — PASS, poi `npm test` — PASS.
- [ ] **Step 5: verifica log**: `bash tools/log-check.sh` — PASS (Task 8 lo estende; qui non deve rompersi).
- [ ] **Step 6: commit:** `feat(mcp-progettazione-escursioni): rotta /mcp online con token e interruttore`

### Task 8: log-check, Caddy e collaudo col connector

**Files:**
- Modify: `tools/log-check.sh` (copre `/mcp` e `/g/`: nessun log di query string, body o punti)
- Create: `infra/mcp.md` (configurazione Caddy per streamable HTTP: timeout lunghi e niente buffering sulle risposte `/mcp`; come accendere/spegnere con `WM_MCP_ENABLED`; rotazione di `WM_MCP_TOKEN`)
- Create: `docs/howto/collaudo-connector-mcp.md` (checklist manuale: connector custom su claude.ai con l'URL col token; richiesta campione «profilo libero da San Giuliano Terme al Monte Serra»; verifiche: tool giusti chiamati, numeri in chat = output dei tool, link che apre il giro, GPX scaricato)

- [ ] **Step 1: estendi `log-check.sh`** con i casi delle rotte nuove; esegui `bash tools/log-check.sh` — PASS.
- [ ] **Step 2: scrivi `infra/mcp.md`** (il blocco Caddy è documentato, si applica sul server alla pubblicazione).
- [ ] **Step 3: scrivi la checklist** del collaudo manuale.
- [ ] **Step 4: commit:** `feat(mcp-progettazione-escursioni): log-check esteso, runbook caddy e collaudo`

## Blocco 3 — POI

### Task 9: Tabella `poi` nel pre-passo

**Files:**
- Modify: `prepare/enrich.py` (estrazione accanto alla tabella `ways`, stessa connessione — punto verificato: `enrich.py:269-272`)
- Test: `engine/tests/` (fixture esistenti del pre-passo, via `docker run --rm -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q`)

**Interfaces:**
- Produces: tabella `poi(osm_id integer primary key, name text, kind text, ele real, lon real, lat real, wikipedia text, wikidata text)` + indice su `(lon, lat)`. Nodi OSM con `name` e almeno uno fra: `natural=peak|saddle|spring`, `amenity=drinking_water|fountain|shelter`, `tourism=alpine_hut|wilderness_hut|viewpoint`, `mountain_pass=yes`, `place=village|hamlet|locality`. `wikipedia`/`wikidata` copiati così come sono (identificatori). **Fail-soft**: un errore nell'estrazione POI logga e lascia il build valido senza tabella.

- [ ] **Step 1: test che falliscono** (pytest sulle fixture: aggiungi alla rete sintetica un nodo cima con `name` + `wikidata` e una fontana senza wiki): la tabella esiste; la cima c'è con `kind='peak'` e il suo `wikidata`; la fontana c'è senza wiki; un nodo senza `name` non c'è.
- [ ] **Step 2: esegui** il pytest in container — FAIL. **Step 3: implementa.** **Step 4: esegui** — PASS.
- [ ] **Step 5: rigenera la cella**: `bash tools/build-graph.sh` coi dati locali (runbook) e verifica `sqlite3 data/ways.sqlite "select count(*) from poi"` > 0.
- [ ] **Step 6: commit:** `feat(mcp-progettazione-escursioni): tabella poi estratta dal pre-passo`

### Task 10: Tool `poi_nearby`

**Files:**
- Create: `gateway/src/mcp/poi.js`
- Modify: `gateway/src/mcp/server.js` (registrazione tool)
- Test: `gateway/test/mcp-poi.test.js`

**Interfaces:**
- Consumes: `ways.sqlite` via better-sqlite3 (path: `WM_WAYS_DB`, in locale `data/ways.sqlite`).
- Produces: tool MCP `poi_nearby` — input `{point: [lon,lat], radiusM?: number (default 500, max 2000)}`, output `{poi: [{name, kind, ele, lonLat, osmId, wikipedia?, wikidata?}], vuoto?: string}`: filtro bbox sull'indice + distanza haversine, ordinato per distanza, max 20. Tabella assente → `{poi: [], vuoto: 'dati senza POI: grafo da rigenerare'}`; zona vuota → `{poi: [], vuoto: 'nessun POI entro <radius> m'}`.

- [ ] **Step 1: test che falliscono** (fixture sqlite costruita nel test): POI entro il raggio trovato e ordinato; fuori raggio escluso; tabella assente → risposta `vuoto`, nessuna eccezione; `horse` mai presente nell'output serializzato.
- [ ] **Step 2: esegui** — FAIL. **Step 3: implementa.** **Step 4: esegui** — PASS, poi `npm test` — PASS.
- [ ] **Step 5: commit:** `feat(mcp-progettazione-escursioni): tool poi_nearby con identificatori wiki`

### Task 11: Controllo di accettazione deterministico

**Files:**
- Create: `gateway/scripts/mcp-check.mjs` (stile `preview-check.mjs`: gira contro il gateway locale vivo)

**Interfaces:**
- Consumes: i tool MCP chiamati in-process (senza AI) e `POST /v1/mcp/route` diretto.
- Produces: script che con la richiesta campione — profilo `libero`, da San Giuliano Terme `[10.4420, 43.7625]` al Monte Serra `[10.5503, 43.7521]` — verifica: numeri del tool = numeri di `/v1` (stessa chiamata, stesso grafo); `linkPreview` che risponde 302; `linkGpx` che scarica un GPX con lo stesso numero di `trkpt` della geometria `/v1`; blob manomesso → 400. Esce 0/1 come `preview-check.mjs`.

- [ ] **Step 1: scrivi lo script.** **Step 2: esegui** `cd gateway && node scripts/mcp-check.mjs` — PASS sul gateway locale.
- [ ] **Step 3: aggiorna il README** (tabella comandi del repo: riga per `mcp-check.mjs`) e il CLAUDE.md (stessa riga nella tabella Comandi).
- [ ] **Step 4: commit:** `feat(mcp-progettazione-escursioni): controllo di accettazione del servizio mcp`

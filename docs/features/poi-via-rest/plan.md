# Piano — I POI via REST, e lo shard per un chiamante che non è un LLM

> **Per chi esegue:** SOTTO-SKILL RICHIESTA: usa `superpowers:subagent-driven-development`
> (consigliata) o `superpowers:executing-plans` per implementare questo piano task per
> task. I passi usano caselle (`- [ ]`) per la tracciatura.

**Obiettivo:** esporre i punti di interesse vicini come rotta HTTP interna, oltre che come
tool MCP, e aggiungere lo shard `walkiria`.

**Architettura:** la ricerca resta una sola, in `src/mcp/poi.js`. Oggi
`makePoiNearbyTool` apre il database a ogni chiamata; il refactor estrae la ricerca in una
funzione che riceve una connessione già aperta, così il tool continua ad aprirla come
prima e la rotta riusa quella che `server.js` tiene aperta in `deps.waysDb`. La rotta si
registra fra gli `handlers` di `createApp`, accanto a `route` e `rejoin`, senza toccare il
middleware di shard che serve il connettore MCP in produzione.

**Stack:** Node ESM, Express 5, better-sqlite3, vitest, supertest.

**Spec:** [overview.md](overview.md)

## Vincoli globali

- **Nessuna operazione git viene eseguita durante l'implementazione.** I commit nel piano
  sono istruzioni per il dev, da eseguire dopo che ha letto il diff.
- **Convenzione dei commit:** `feat(poi-via-rest): …`, `fix(poi-via-rest): …`,
  `refactor(poi-via-rest): …`.
- **Lingua del repo:** documentazione, commenti e log in italiano; identificatori nel
  codice in inglese.
- **Il comportamento del server MCP non cambia.** `gateway/scripts/mcp-check.mjs` e
  `scheda-check.mjs` devono passare come prima del lavoro.
- **Nessuna coordinata nei log.** Regola del repo, verificata da `tools/log-check.sh`: la
  rotta nuova non registra punti, raggi né query string.
- **Test:** `cd gateway && npm test` (vitest), test in `gateway/test/*.test.js`.
- **Limiti invariati**, copiati dalla spec: raggio fra 1 e 2.000 metri con default 500, al
  massimo 20 risultati, ordinati per distanza crescente.

## Review Focus

Classi di input che la spec implica e che ogni task deve coprire con un test proprio:

1. **Punto non valido** — coordinate assenti, non numeriche o di lunghezza errata: il tool
   oggi risponde `{stato: 'coordinate_non_valide'}`, la rotta deve rispondere `400` con lo
   stesso stato, non un errore non gestito. *(Task 2)*
2. **Raggio fuori intervallo** — valori negativi, zero, oltre 2.000 o non numerici:
   vengono riportati dentro l'intervallo come fa il tool, non rifiutati. *(Task 1, Task 2)*
3. **Grafo senza la tabella `poi`** — un grafo vecchio non è un errore: la risposta è
   `{poi: [], vuoto: 'dati senza POI: grafo da rigenerare'}` e lo deve restare anche sulla
   rotta. *(Task 1, Task 2)*
4. **Nessun risultato nel raggio** — lista vuota, non `404`. *(Task 2)*
5. **Più di 20 POI nel raggio** — il taglio avviene dopo l'ordinamento per distanza, quindi
   restano i venti più vicini. *(Task 1)*

---

### Task 1: la ricerca accetta una connessione già aperta

**File:**
- Modifica: `gateway/src/mcp/poi.js`
- Test: `gateway/test/mcp-poi.test.js`

**Interfacce:**
- Produce: `searchPoiNearby(db, {point, radiusM}) → {poi: [...]} | {stato: 'coordinate_non_valide'} | {poi: [], vuoto: string}`, dove `db` è un'istanza `better-sqlite3` già aperta in sola lettura. `makePoiNearbyTool({waysDbPath})` resta invariata nella firma e nel comportamento: apre il database e delega a `searchPoiNearby`.

- [ ] **Passo 1: scrivi il test che fallisce**

```js
import {searchPoiNearby} from '../src/mcp/poi.js';

it('cerca su una connessione gia\' aperta, senza riaprirla', () => {
  const db = new Database(fixtureDb([vicino, senzaWiki, lontano]), {readonly: true});
  const r = searchPoiNearby(db, {point: CENTRO, radiusM: 500});
  expect(r.poi.map(p => p.name)).toEqual(['Monte Prova', 'Fonte di Prova']);
  db.close();
});

it('tiene i venti piu\' vicini quando il raggio ne contiene di piu\'', () => {
  const molti = Array.from({length: 25}, (_, i) =>
    [100 + i, `Cima ${i}`, 'peak', 900, 10.5 + i * 0.0001, 43.75, null, null]);
  const db = new Database(fixtureDb(molti), {readonly: true});
  const r = searchPoiNearby(db, {point: CENTRO, radiusM: 2000});
  expect(r.poi).toHaveLength(20);
  expect(r.poi[0].name).toBe('Cima 0');
  db.close();
});

it('raggio fuori intervallo: riportato dentro, non rifiutato', () => {
  const db = new Database(fixtureDb([vicino]), {readonly: true});
  expect(searchPoiNearby(db, {point: CENTRO, radiusM: -5}).poi).toBeDefined();
  expect(searchPoiNearby(db, {point: CENTRO, radiusM: 99999}).poi).toBeDefined();
  db.close();
});

it('tabella poi assente: non e\' un errore, e\' una risposta dichiarata', () => {
  const path = join(dir, `vuoto-${Math.random().toString(36).slice(2)}.sqlite`);
  new Database(path).close();
  const db = new Database(path, {readonly: true});
  expect(searchPoiNearby(db, {point: CENTRO})).toMatchObject({poi: [], vuoto: expect.any(String)});
  db.close();
});
```

- [ ] **Passo 2: esegui il test e verifica che fallisca**

Esegui: `cd gateway && npx vitest run test/mcp-poi.test.js`
Atteso: FAIL, `searchPoiNearby is not a function`

- [ ] **Passo 3: estrai `searchPoiNearby(db, {point, radiusM})` in `gateway/src/mcp/poi.js`**

Sposta nella funzione nuova tutto il corpo attuale di `poiNearby` **tranne** l'apertura e
la chiusura del database. `makePoiNearbyTool({waysDbPath})` resta e diventa l'involucro che
apre la connessione, chiama `searchPoiNearby` e la chiude: il ramo `catch` sull'apertura
continua a restituire `SENZA_TABELLA`, com'è oggi.

- [ ] **Passo 4: esegui tutti i test del gateway**

Esegui: `cd gateway && npm test`
Atteso: PASS — inclusi i test preesistenti di `makePoiNearbyTool`, che non devono cambiare

- [ ] **Passo 5: esegui l'accettazione dell'MCP**

Esegui: `cd gateway && node scripts/mcp-check.mjs` (richiede il gateway avviato)
Atteso: PASS, stesso esito di prima del refactor

- [ ] **Passo 6: commit**

```bash
git add gateway/src/mcp/poi.js gateway/test/mcp-poi.test.js
git commit -m "refactor(poi-via-rest): searchPoiNearby accetta una connessione aperta"
```

---

### Task 2: la rotta HTTP

**File:**
- Modifica: `gateway/src/app.js`
- Modifica: `gateway/src/server.js`
- Test: `gateway/test/poi-route.test.js` (nuovo)

**Interfacce:**
- Consuma: `searchPoiNearby(db, {point, radiusM})` dal Task 1.
- Produce: `makePoiHandler({waysDb}) → (req, res)`, esportata da `gateway/src/poi-handler.js`, registrata in `createApp` come `handlers.poi` su `GET /v1/:shard/poi` con i parametri in query string: `lon`, `lat`, `radiusM` opzionale.

- [ ] **Passo 1: scrivi il test che fallisce**

```js
it('restituisce i POI entro il raggio, ordinati per distanza', async () => {
  const r = await request(app()).get('/v1/walkiria/poi').query({lon: 10.5, lat: 43.75, radiusM: 500});
  expect(r.status).toBe(200);
  expect(r.body.poi.map(p => p.name)).toEqual(['Monte Prova', 'Fonte di Prova']);
  expect(r.body.poi[0]).toMatchObject({kind: 'peak', ele: 917, osmId: 1, wikidata: 'Q1'});
});

it('coordinate non valide: 400 con lo stesso stato del tool', async () => {
  const r = await request(app()).get('/v1/walkiria/poi').query({lon: 'x', lat: 43.75});
  expect(r.status).toBe(400);
  expect(r.body).toEqual({stato: 'coordinate_non_valide'});
});

it('raggio mancante: vale il default di 500 metri', async () => {
  const r = await request(app()).get('/v1/walkiria/poi').query({lon: 10.5, lat: 43.75});
  expect(r.status).toBe(200);
  expect(r.body.poi.map(p => p.name)).toEqual(['Monte Prova', 'Fonte di Prova']);
});

it('nessun risultato nel raggio: lista vuota, non 404', async () => {
  const r = await request(app()).get('/v1/walkiria/poi').query({lon: 11.9, lat: 43.99, radiusM: 10});
  expect(r.status).toBe(200);
  expect(r.body.poi).toEqual([]);
});

it('shard sconosciuto: 404, come le altre rotte /v1', async () => {
  const r = await request(app()).get('/v1/inesistente/poi').query({lon: 10.5, lat: 43.75});
  expect(r.status).toBe(404);
});
```

- [ ] **Passo 2: esegui il test e verifica che fallisca**

Esegui: `cd gateway && npx vitest run test/poi-route.test.js`
Atteso: FAIL, 404 su `/v1/walkiria/poi`

- [ ] **Passo 3: implementa `makePoiHandler({waysDb})` in `gateway/src/poi-handler.js`**

Legge `lon`, `lat` e `radiusM` dalla query, chiama `searchPoiNearby`, e traduce
`{stato: 'coordinate_non_valide'}` in un `400` con quel corpo; ogni altra risposta è `200`
con il corpo così com'è. **Nessun log di coordinate**: se serve registrare la chiamata,
passa da `gateway/src/log.js` e non include query string né punti.

- [ ] **Passo 4: registra la rotta in `createApp`**

In `gateway/src/app.js`, accanto a `route` e `rejoin`:
`if (handlers.poi) app.get('/v1/:shard/poi', handlers.poi);`
In `gateway/src/server.js`, costruisci l'handler con la connessione già aperta
(`waysDb`) e passalo in `handlers`.

- [ ] **Passo 5: esegui i test**

Esegui: `cd gateway && npm test`
Atteso: PASS

- [ ] **Passo 6: verifica che nessuna coordinata finisca nei log**

Esegui: `bash tools/log-check.sh`
Atteso: PASS

- [ ] **Passo 7: commit**

```bash
git add gateway/src/poi-handler.js gateway/src/app.js gateway/src/server.js gateway/test/poi-route.test.js
git commit -m "feat(poi-via-rest): rotta GET /v1/:shard/poi"
```

---

### Task 3: lo shard `walkiria`

**File:**
- Modifica: `gateway/config/shards.json`
- Test: `gateway/test/config.test.js`

**Interfacce:**
- Produce: lo shard `walkiria` con i sei profili pubblici, `maxPoints: 25`, `origins: []`, `limits: true`, `rate: {capacity: 120, perSecond: 4}`.

- [ ] **Passo 1: scrivi il test che fallisce**

```js
it('lo shard walkiria accetta 25 punti e non e\' chiamato da un browser', () => {
  const s = config.shards.walkiria;
  expect(s.maxPoints).toBe(25);
  expect(s.origins).toEqual([]);
  expect(Object.keys(s.profiles).sort())
    .toEqual(['alpinista', 'escursionista', 'esperto', 'libero', 'mtb', 'prudente']);
});
```

- [ ] **Passo 2: esegui il test e verifica che fallisca**

Esegui: `cd gateway && npx vitest run test/config.test.js`
Atteso: FAIL, `Cannot read properties of undefined`

- [ ] **Passo 3: aggiungi lo shard a `gateway/config/shards.json`**

Stessa forma di `mcp`, con `origins: []`. **Non si riusa `mcp`**: un picco di Walkiria
consumerebbe i gettoni del connettore delle chat.

- [ ] **Passo 4: esegui i test**

Esegui: `cd gateway && npm test`
Atteso: PASS

- [ ] **Passo 5: commit**

```bash
git add gateway/config/shards.json gateway/test/config.test.js
git commit -m "feat(poi-via-rest): shard walkiria con maxPoints 25"
```

---

### Task 4: la rotta resta interna, e la documentazione lo dice

**File:**
- Modifica: `docs/runbook.md`
- Modifica: `docs/knowledge/mcp-progettazione-escursioni.md`

- [ ] **Passo 1: scrivi la procedura in `docs/runbook.md`**

Una sezione che dice come Caddy **non** deve pubblicare `/v1/:shard/poi`, e come si
verifica dopo il deploy: una `GET` da una macchina esterna deve ricevere `404` dal reverse
proxy, mentre la stessa chiamata su `127.0.0.1:8991` risponde `200`. Il comando esatto di
verifica va nella sezione, perché è quello che qualcuno rieseguirà fra sei mesi.

- [ ] **Passo 2: aggiungi una riga in `docs/knowledge/mcp-progettazione-escursioni.md`**

Nella sezione «Come funziona oggi»: i POI hanno un secondo consumatore oltre all'MCP — la
rotta interna usata da Walkiria — e la ricerca è una sola, in `src/mcp/poi.js`. **Non
riscrivere la pagina:** il metodo a fasi resta una proprietà dell'MCP e non cambia.

- [ ] **Passo 3: aggiungi la riga all'indice del `CLAUDE.md`**

Nella sezione che quel repo già usa per indicizzare la conoscenza, senza migrarne la forma.

- [ ] **Passo 4: commit**

```bash
git add docs/runbook.md docs/knowledge/mcp-progettazione-escursioni.md CLAUDE.md
git commit -m "docs(poi-via-rest): rotta interna e secondo consumatore dei POI"
```

---

## Dopo l'ultimo task

Il lavoro è pronto per la review. **Non aprire la PR e non fare push**: il dev legge il
diff, decide, e la PR va verso `develop`.

**Dipendenza a valle:** il task di Walkiria che consuma i POI non può partire prima che
questa rotta esista e sia raggiungibile dalla rete interna.

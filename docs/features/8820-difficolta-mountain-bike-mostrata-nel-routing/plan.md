> Ticket: oc:8820

# Difficolta' mountain bike mostrata nel routing — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** col profilo `mtb` il servizio mostra la difficolta' nella scala CAI per
mountain bike (`TC`, `MC`, `BC`, `OC`, `EC`) invece di quella escursionistica,
senza sostituirla.

**Architecture:** la difficolta' MTB segue la stessa strada di quella a piedi —
il pre-passo la ricava dai tag OSM e la scrive nella tabella laterale, il gateway
la traduce in sigle, preview e scheda la mostrano. Si aggiungono colonne, non se
ne cambiano: i consumatori scelgono la tabella delle sigle in base al `profile`
che ogni segmento gia' dichiara. Il custom model non si tocca.

**Tech Stack:** Python con osmium e sqlite3 (pre-passo), Node ESM con vitest
(gateway), HTML/JS senza framework (preview e scheda).

**Spec:** `docs/features/8820-difficolta-mountain-bike-mostrata-nel-routing/overview.md`

## Global Constraints

- Le sigle CAI si riportano, non si deducono: nessuna difficolta' ricavata da
  `tracktype`, `surface` o altri tag. Dove il dato manca, la difficolta' e'
  sconosciuta.
- `engine/profiles/mtb_wm.json` non si tocca: `version` e `sha256` in
  `gateway/config/profiles.json` restano invariati (`gateway/test/config.test.js`).
- Nessuna coordinata nei log: ogni log nuovo passa da `gateway/src/log.js`;
  `bash tools/log-check.sh` lo verifica.
- Documentazione, commenti e testi in italiano; identificatori in inglese.
  Niente accenti nei file del repo: si usa l'apostrofo (`difficolta'`).
- Nessun i18n: i testi visibili si scrivono in chiaro in italiano.
- Commit: `feat(oc:8820): ...`. **I comandi git di questo piano sono istruzioni
  per il dev, non azioni da eseguire in autonomia.**
- `map-core` non si tocca.

## Review Focus

1. **Sigla CAI con il `+`** (`MC+`, `TC+`): a Parma e' su 3 itinerari su 27 in
   discesa e 9 su 27 in salita. Se non viene normalizzata diventa «sconosciuta»,
   cioe' si perde il dato migliore proprio dove c'e'. Coperto dal Task 1.
2. **Tratto in piu' itinerari MTB con gradi diversi** (varianti e anelli che
   condividono tratti): deve vincere il piu' difficile, come fa `effective()`
   con i `cai_values`. Coperto dal Task 2.
3. **Tabella laterale senza le colonne nuove** (gateway aggiornato prima del
   grafo): deve continuare a rispondere con la difficolta' a piedi, non andare
   in errore. Coperto dal Task 4.
4. **Segmento calcolato col profilo di ripiego** (`mtb` → `libero`): porta un
   `profile` diverso dal giro e non va mostrato nella scala MTB. Coperto dal
   Task 6.
5. **Sigla sconosciuta ai consumatori**: oggi `preview/preview.js:398-442`,
   `preview/scheda.js:40-42` e `gateway/src/mcp/compact.js:17` ripiegano in
   silenzio su «sconosciuta» per ogni valore fuori tabella. Coperto dai Task 6,
   7 e 8.

---

### Task 1: Scala CAI MTB e traduzione di `mtb:scale`

> ⚠️ L'implementazione ha deviato da questo task: [notes.md](notes.md#task-1-niente-traduzione-fra-le-due-scale)

**Files:**
- Modify: `prepare/difficulty.py`
- Test: `prepare/tests/test_difficulty.py`

**Interfaces:**
- Produces: `CAI_MTB` (dict sigla → rating 1-5), `MTB_BY_RATING` (dict rating →
  sigla), `cai_mtb_to_rating(value) -> int | None`,
  `mtb_scale_to_rating(value) -> int | None`, `rating_to_cai_mtb(rating) -> str | None`.

- [ ] **Step 1: Scrivere i test che falliscono**

```python
from difficulty import cai_mtb_to_rating, mtb_scale_to_rating, rating_to_cai_mtb

def test_cai_mtb():
    assert cai_mtb_to_rating("TC") == 1
    assert cai_mtb_to_rating("MC") == 2
    assert cai_mtb_to_rating("BC") == 3
    assert cai_mtb_to_rating("OC") == 4
    assert cai_mtb_to_rating("EC") == 5
    # il "+" segnala pendenze sostenute, non cambia il grado
    assert cai_mtb_to_rating("MC+") == 2
    assert cai_mtb_to_rating("TC+") == 1
    assert cai_mtb_to_rating(" bc ") == 3
    assert cai_mtb_to_rating("boh") is None
    assert cai_mtb_to_rating(None) is None

def test_mtb_scale():
    # Singletrail-Skala 0-6 sui cinque gradi CAI: 5 e 6 si schiacciano su EC
    assert mtb_scale_to_rating("0") == 1
    assert mtb_scale_to_rating("1") == 2
    assert mtb_scale_to_rating("2") == 3
    assert mtb_scale_to_rating("3") == 4
    assert mtb_scale_to_rating("4") == 5
    assert mtb_scale_to_rating("5") == 5
    assert mtb_scale_to_rating("6") == 5
    # i modificatori del wiki OSM valgono per tutti i valori numerici
    assert mtb_scale_to_rating("1+") == 2
    assert mtb_scale_to_rating("0-") == 1
    assert mtb_scale_to_rating("boh") is None
    assert mtb_scale_to_rating(None) is None

def test_rating_to_cai_mtb():
    assert rating_to_cai_mtb(1) == "TC"
    assert rating_to_cai_mtb(5) == "EC"
    assert rating_to_cai_mtb(0) is None
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `docker run --rm -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q`
Expected: FAIL, `ImportError: cannot import name 'cai_mtb_to_rating'`

- [ ] **Step 3: Implementare in `prepare/difficulty.py`**

Accanto alle tabelle esistenti, con un commento che spiega la corrispondenza
scelta fra Singletrail-Skala e scala CAI e che la dichiara nostra. `+` e `-`
finali si tolgono prima di tradurre, come `cai_to_rating` fa con `EEA:*`.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `docker run --rm -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add prepare/difficulty.py prepare/tests/test_difficulty.py
git commit -m "feat(oc:8820): scala CAI per la mountain bike e traduzione di mtb:scale"
```

---

### Task 2: Il pre-passo legge le relazioni `route=mtb`

**Files:**
- Modify: `prepare/enrich.py` (`Relations.relation`, riga 123; `Areas.__init__`, riga 143)
- Modify: `engine/tests/rete.opl` (fixture: aggiunta di una relazione MTB)
- Test: `prepare/tests/test_enrich.py`

**Interfaces:**
- Consumes: `cai_mtb_to_rating` dal Task 1.
- Produces: su `Relations` e `Areas` le strutture `cai_mtb_by_way` (way_id →
  lista di sigle di discesa), `cai_mtb_up_by_way` (way_id → lista di sigle di
  salita), `refs_mtb_by_way` (way_id → set di `ref`), `rels_mtb_by_way` (way_id →
  set di id relazione), tenute distinte da quelle a piedi.

- [ ] **Step 1: Aggiungere alla fixture una relazione MTB**

In `engine/tests/rete.opl`, con i valori veri del Parmense: una relazione
`route=mtb` con `cai_scale:mtb=MC+`, `cai_scale:mtb:uphill=BC`, un `ref`, e come
membri due way gia' presenti nella rete, di cui almeno uno condiviso con una
relazione `route=hiking` esistente (serve a provare che i due elenchi non si
mescolano). Una seconda relazione `route=mtb` con `cai_scale:mtb=BC` su uno di
quei due way, per il caso «piu' itinerari sullo stesso tratto».

- [ ] **Step 2: Scrivere i test che falliscono**

```python
def test_relazioni_mtb_separate_da_quelle_a_piedi(result):
    _, rows, _ = result
    r = rows[<way condiviso>]
    assert r["refs"] == "<ref a piedi>"          # l'elenco a piedi non cambia
    assert r["refs_mtb"] == "<ref MTB>"          # quello MTB e' suo

def test_piu_itinerari_mtb_sullo_stesso_tratto_vince_il_piu_difficile(result):
    _, rows, _ = result
    assert rows[<way condiviso>]["cai_mtb"] == "BC"   # BC (3) batte MC+ (2)
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `docker run --rm -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q`
Expected: FAIL, `KeyError: 'refs_mtb'`

- [ ] **Step 4: Implementare la lettura in `prepare/enrich.py`**

In `Relations.relation`, il primo `return` oggi scarta tutto cio' che non e'
`route=hiking|foot`: va fatto passare anche `route=mtb`, instradando i suoi tag
nelle strutture MTB e lasciando intatte quelle a piedi. Un tratto puo' stare in
entrambi i tipi di relazione. Le nuove strutture vanno propagate in
`Areas.__init__` come gia' avviene per `cai_by_way`, `refs_by_way`, `rels_by_way`.

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `docker run --rm -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add prepare/enrich.py prepare/tests/test_enrich.py engine/tests/rete.opl
git commit -m "feat(oc:8820): il pre-passo legge le relazioni route=mtb"
```

---

### Task 3: Difficolta' MTB del tratto e colonne nella tabella laterale

**Files:**
- Modify: `prepare/enrich.py` (`effective`, riga 91; `Classify.way`, riga 226;
  `flush`, riga 256; `create table ways`, riga 327)
- Test: `prepare/tests/test_enrich.py`

**Interfaces:**
- Consumes: le strutture del Task 2, `mtb_scale_to_rating` e `rating_to_cai_mtb`
  dal Task 1.
- Produces: `effective_mtb(cai_mtb_values, own_mtb_scale) -> (int, str)` dove
  l'origine e' `"cai_mtb"`, `"mtb_scale"` o `"none"`; e le colonne nuove della
  tabella `ways`: `cai_mtb`, `cai_mtb_up`, `mtb_scale`, `mtb_rating`,
  `mtb_origin`, `refs_mtb`, `rel_ids_mtb`.

- [ ] **Step 1: Scrivere i test che falliscono**

```python
from enrich import effective_mtb

def test_effective_mtb_priorita():
    # la sigla dell'itinerario vince sul tag del tratto, come a piedi
    assert effective_mtb(["MC"], "4") == (2, "cai_mtb")
    # senza itinerario vale il tag del tratto
    assert effective_mtb([], "2") == (3, "mtb_scale")
    # fra piu' itinerari vince il piu' difficile
    assert effective_mtb(["MC", "BC"], None) == (3, "cai_mtb")
    # niente dato, niente deduzione
    assert effective_mtb([], None) == (0, "none")

def test_colonne_mtb_nella_tabella(result):
    _, rows, _ = result
    r = rows[<way con mtb:scale nella fixture>]
    assert r["mtb_rating"] > 0 and r["mtb_origin"] == "mtb_scale"
    assert r["mtb_scale"] == "<valore grezzo>"
    assert rows[<way MTB della fixture>]["cai_mtb_up"] == "BC"

def test_difficolta_a_piedi_invariata(result):
    _, rows, _ = result
    assert rows[<way con sac_scale>]["origin"] == "sac"   # le due convivono
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `docker run --rm -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q`
Expected: FAIL, `ImportError: cannot import name 'effective_mtb'`

- [ ] **Step 3: Implementare `effective_mtb` e le colonne**

`effective_mtb` ricalca `effective`: `max()` sui rating delle sigle di itinerario,
altrimenti il rating del tag del tratto, altrimenti `(0, "none")`. Niente
ghiacciai, vie ferrate o visibilita': non sono della scala MTB. In `Classify.way`
si calcola accanto a `effective` e si accodano i nuovi valori a `self.rows`;
`flush` e il `create table` vanno allineati al nuovo numero di colonne.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `docker run --rm -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q`
Expected: PASS, compresi i test gia' esistenti sulla difficolta' a piedi

- [ ] **Step 5: Verificare il motore sulla rete sintetica**

Run: `bash engine/tests/smoke.sh`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add prepare/enrich.py prepare/tests/test_enrich.py
git commit -m "feat(oc:8820): difficolta' MTB del tratto e colonne nella tabella laterale"
```

---

### Task 4: Il gateway traduce il rating MTB e legge le colonne nuove

> ⚠️ L'implementazione ha deviato da questo task: [notes.md](notes.md#task-4-la-condizione-di-scendere-dalla-bici-era-gia-esposta)

**Files:**
- Modify: `gateway/src/difficulty.js`
- Modify: `gateway/src/details.js` (cascata delle colonne, righe 28-33;
  costruzione del segmento, righe 42-50)
- Test: `gateway/test/details.test.js`

**Interfaces:**
- Produces: `ratingToCaiMtb(rating, origin) -> string | null` in `difficulty.js`;
  `summarizeDetails` accetta un terzo parametro `profile` e ogni segmento porta
  in piu' `mtbScale` (il grezzo), `caiMtbUp` (la sigla di salita) e `getOffBike`
  (booleano, la condizione accanto al grado).

- [ ] **Step 1: Scrivere i test che falliscono**

```js
import {ratingToCaiMtb} from '../src/difficulty.js';

it('ratingToCaiMtb', () => {
  expect(ratingToCaiMtb(1)).toBe('TC');
  expect(ratingToCaiMtb(3)).toBe('BC');
  expect(ratingToCaiMtb(5)).toBe('EC');
  expect(ratingToCaiMtb(0)).toBe(null);
  // «si scende dalla bici» non e' un grado: non sostituisce la sigla, la
  // accompagna, quindi la traduzione del rating non cambia
  expect(ratingToCaiMtb(2, 'get_off_bike')).toBe('MC');
});

it('il tratto da fare a piedi con la bici porta la condizione accanto al grado', () => {
  const seg = summarizeDetails(pathConGetOffBike, waysDb, 'mtb').segments[0];
  expect(seg.difficulty).toBe('MC');
  expect(seg.getOffBike).toBe(true);
});

it('col profilo mtb usa la scala MTB e lascia intatta quella a piedi', () => {
  // stesso path dei test esistenti, con rows che hanno le colonne MTB
  const seg = summarizeDetails(path, waysDb, 'mtb').segments[0];
  expect(seg.difficulty).toBe('BC');
  expect(seg.origin).toBe('cai_mtb');
  expect(seg.mtbScale).toBe('3');
});

it('con una tabella laterale senza colonne MTB non va in errore', () => {
  // waysDb che accetta solo il vecchio elenco di colonne
  const seg = summarizeDetails(path, oldWaysDb, 'mtb').segments[0];
  expect(seg.difficulty).toBe(null);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `cd gateway && npm test -- details`
Expected: FAIL, `ratingToCaiMtb is not a function`

- [ ] **Step 3: Implementare**

In `difficulty.js` la tabella MTB accanto a `CAI`, con la stessa forma di
`ratingToCai`. In `details.js` un gradino in piu' in cima alla cascata, con
l'elenco completo delle colonne; la scelta della scala guarda il profilo;
`get_off_bike`, che `route.js:7-8` gia' chiede e che oggi non viene letto,
diventa un campo booleano del segmento — non un'origine e non un grado, perche'
un tratto da spingere ha comunque la sua difficolta'.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `cd gateway && npm test`
Expected: PASS, compresi `config.test.js` (impronta dei profili invariata) e i
test esistenti su `details`

- [ ] **Step 5: Commit**

```bash
git add gateway/src/difficulty.js gateway/src/details.js gateway/test/details.test.js
git commit -m "feat(oc:8820): il gateway traduce il rating MTB nelle sigle CAI"
```

---

### Task 5: Un test che tiene allineate le due tabelle delle sigle

**Files:**
- Create: `gateway/test/sigle-allineate.test.js`
- Modify: `prepare/difficulty.py` (solo se il test rivela una divergenza da sanare)

**Interfaces:**
- Consumes: `ratingToCai` e `ratingToCaiMtb` da `gateway/src/difficulty.js`.

Le due tabelle sono **gia' oggi divergenti**: `prepare/difficulty.py` conosce
`TQ`, che il gateway non ha; `gateway/src/difficulty.js` schiaccia i rating 5 e 6
su `EEA`, il pre-passo no. Nessun test le confronta, e la seconda scala raddoppia
la superficie.

- [ ] **Step 1: Scrivere il test che fallisce**

Il test legge `prepare/difficulty.py` come testo, ne estrae le tabelle con una
espressione regolare e le confronta con quelle di `gateway/src/difficulty.js`
rating per rating, per entrambe le scale. Ogni divergenza voluta va dichiarata in
un elenco esplicito nel test, con il motivo: cosi' una divergenza nuova fallisce,
una vecchia e' documentata.

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd gateway && npm test -- sigle-allineate`
Expected: FAIL, con l'elenco delle divergenze attuali

- [ ] **Step 3: Dichiarare le divergenze note e far passare il test**

`TQ` e lo schiacciamento di 5 e 6 su `EEA` sono voluti: vanno nell'elenco delle
eccezioni con il commento che spiega perche'. Nessuna modifica al comportamento.

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `cd gateway && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/test/sigle-allineate.test.js
git commit -m "test(oc:8820): le tabelle delle sigle del pre-passo e del gateway restano allineate"
```

---

### Task 6: Colori, legenda e riepilogo nella preview

> ⚠️ L'implementazione ha deviato da questo task: [notes.md](notes.md#task-6-la-tabella-dei-tratti-mostra-le-fonti-non-la-difficolta-risolta)

**Files:**
- Modify: `preview/preview.js` (`COLOR_SETS.difficolta` righe 66-75, `DIFF_ORDER`
  riga 398, `DIFF_SHORT` riga 440, `diffLabel` riga 442, `DIFF_TEXT` riga 649,
  dettaglio del segmento riga 709)
- Modify: `preview/index.html` (etichette della vista, riga 241)
- Test: `cd gateway && node scripts/preview-check.mjs` e `preview-ux-check.mjs`

**Interfaces:**
- Consumes: i segmenti del Task 4, con `difficulty` nella scala del profilo,
  `origin` fra le fonti MTB e il campo `profile` gia' presente per segmento.

- [ ] **Step 1: Aggiungere la scala MTB alle tabelle della preview**

Un secondo insieme di voci accanto a `COLOR_SETS.difficolta`, con i cinque gradi
sulla stessa rampa di gravita' crescente (`TC` verde … `EC` viola), la sigla
sempre scritta nell'etichetta, e in fondo — staccate dai gradi, dove oggi stanno
`Via ferrata` e `Ghiacciaio` — la voce «a piedi con la bici» e quella della
difficolta' sconosciuta. `DIFF_ORDER`, `DIFF_SHORT` e `DIFF_TEXT` hanno il
gemello MTB; la scelta fra i due insiemi guarda il profilo del segmento, cosi' un
segmento calcolato col profilo di ripiego resta nella sua scala.

- [ ] **Step 2: Scrivere in testa alla legenda quale scala mostra**

Una riga sopra le voci: «Difficolta' per la mountain bike (scala CAI)» oppure
quella escursionistica, secondo il profilo del giro.

- [ ] **Step 3: Verificare la preview**

Run: `cd gateway && node scripts/preview-check.mjs && node scripts/preview-ux-check.mjs`
Expected: PASS

- [ ] **Step 4: Verificare a mano un giro col profilo bici**

Nessun tratto deve uscire con la parola «sconosciuta» accanto a un colore della
scala MTB; la difficolta' complessiva del giro deve essere valorizzata.

- [ ] **Step 5: Commit**

```bash
git add preview/preview.js preview/index.html
git commit -m "feat(oc:8820): colori, legenda e riepilogo nella scala della mountain bike"
```

---

### Task 7: La scheda nella scala del profilo

> ⚠️ L'implementazione ha deviato da questo task: [notes.md](notes.md#task-7-la-scheda-non-ha-richiesto-modifiche)

**Files:**
- Modify: `preview/scheda.js` (raggruppamento per `ref|difficolta`, righe 40-42)
- Modify: `preview/scheda.css` (se servono stili per le voci nuove)
- Test: `cd gateway && node scripts/scheda-check.mjs` (richiede il gateway vivo)

**Interfaces:**
- Consumes: i segmenti del Task 4 e le tabelle del Task 6.

- [ ] **Step 1: Mostrare la difficolta' nella scala del profilo**

Il raggruppamento dei tratti per `ref` e difficolta' resta com'e'; cambia la
sigla mostrata. Le sigle restano **testo**, non solo campiture, perche' la scheda
si stampa anche in bianco e nero.

- [ ] **Step 2: Verificare**

Run: `cd gateway && node scripts/scheda-check.mjs`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add preview/scheda.js preview/scheda.css
git commit -m "feat(oc:8820): la scheda mostra la difficolta' nella scala del profilo"
```

---

### Task 8: Il documento MCP

**Files:**
- Modify: `gateway/src/mcp/compact.js` (chiave di raggruppamento, riga 17)
- Test: `gateway/test/mcp-compact.test.js`, `cd gateway && node scripts/mcp-check.mjs`

**Interfaces:**
- Consumes: i segmenti del Task 4; `compact.js` gia' manda `profilo: j.profile`.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
it('col profilo mtb i tratti portano le sigle della scala MTB', () => {
  const c = compact(routeMtb);
  expect(Object.keys(c.sentieri).some(k => k.includes('BC'))).toBe(true);
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `cd gateway && npm test -- mcp-compact`
Expected: FAIL

- [ ] **Step 3: Implementare**

La chiave di raggruppamento usa la sigla che arriva dal segmento, qualunque sia
la scala; va verificato che il profilo resti nel payload, perche' e' l'unico
appiglio che ha il modello per sapere quale vocabolario sta leggendo.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `cd gateway && npm test && node scripts/mcp-check.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mcp/compact.js gateway/test/mcp-compact.test.js
git commit -m "feat(oc:8820): il documento MCP riporta le sigle della scala attiva"
```

---

### Task 9: Verifica d'insieme e documentazione

**Files:**
- Modify: `docs/knowledge/routing-escursionistico.md` (o pagina nuova, da
  decidere in `Fase: update-context`)
- Modify: `CLAUDE.md` (indice della conoscenza)

- [ ] **Step 1: Eseguire tutta la verifica**

```bash
cd gateway && npm test
docker run --rm -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q
bash engine/tests/smoke.sh
bash tools/log-check.sh
cd gateway && node scripts/preview-check.mjs && node scripts/preview-ux-check.mjs
```
Expected: tutto PASS

- [ ] **Step 2: Verificare che l'impronta dei profili non sia cambiata**

Run: `cd gateway && npm test -- config`
Expected: PASS — se fallisce, qualcuno ha toccato il custom model, che questo
lavoro non deve toccare.

- [ ] **Step 3: Scrivere la pagina di conoscenza**

Come il servizio ricava e mostra la difficolta' in bici, la scelta di riportare e
non dedurre le sigle CAI, e la corrispondenza fra Singletrail-Skala e scala CAI
con la dichiarazione che e' nostra.

- [ ] **Step 4: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs(oc:8820): conoscenza della difficolta' mountain bike"
```

---

## Ordine di rilascio

Prima la ricostruzione dei dati sul server (`ssh wm-tiles`,
`bash tools/build-graph.sh`), poi il gateway. Nell'ordine inverso il gateway
ripiega in silenzio sulle colonne vecchie e ogni tratto in bici risulta senza
difficolta', senza errori nei log.

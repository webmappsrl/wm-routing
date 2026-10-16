# Routing escursionistico — piano di implementazione

> **Per chi esegue con un agente:** sotto-skill richiesta:
> `superpowers:subagent-driven-development` (consigliata) oppure
> `superpowers:executing-plans`, task per task. I passi usano le caselle
> (`- [ ]`) per tenere traccia.
>
> **Nessun commit automatico.** I comandi `git commit` qui sotto sono
> istruzioni per il dev: non si eseguono senza la sua conferma esplicita,
> commit per commit. Nessun branch creato in autonomia. Ogni comando SSH verso
> un server si mostra al dev e si esegue solo dopo il suo ok.

**Obiettivo:** un servizio di routing escursionistico (GraphHopper dietro un
gateway Node) che calcola tracciati e rientri sulla traccia sugli stessi dati
OSM e DEM di wm-tiles, con una preview OpenLayers che lo confronta con il
GraphHopper di produzione.

**Architettura:** quattro pezzi in container. (1) `prepare/` ritaglia il PBF di
wm-tiles sul rettangolo del DEM e lo arricchisce: scrive in `sac_scale` la
difficolta' effettiva (modello CAI), marca le catene lunghe di sentieri
sconosciuti in `horse_scale`, chiude le zone militari, e produce una tabella
laterale SQLite con i valori originali. (2) `engine/` e' GraphHopper compilato
da un commit fissato, con i cinque profili come custom model, grafo mappato su
file e quote da un PMTiles a z13. (3) `gateway/` e' l'interfaccia pubblica
`/v1`: shard e profili, CORS, limite di richieste, log senza coordinate,
dettagli per tratto, tempo DIN 33466, rientro sulla traccia. (4) `preview/` e'
una pagina OpenLayers servita dal gateway. Script in `tools/` costruiscono il
grafo di notte, lo controllano con i percorsi di prova e lo scambiano.

**Tech stack:** GraphHopper 12.0-SNAPSHOT al commit `97f7fde` (Java 21, Maven);
Python 3.12 con `osmium` (pyosmium 4), `shapely` 2 e `pmtiles`; Node 20 con
Express 5, `better-sqlite3`, Vitest e Supertest; OpenLayers 7.3.0 e
ol-mapbox-style 11.0.0 da jsdelivr; Docker Compose; Caddy (gia' sul server).

**Spec:** [overview.md](overview.md). [map-core.md](map-core.md) contiene
direttive future per l'app: **non** fa parte di questo piano.

## Vincoli globali

- Tutto il codice sta in `wm-routing` (`/Users/bongiu/Documents/wm-routing`).
  In wm-tiles si toccano solo `infra/pubblica-dominio.sh` (il `Caddyfile`
  importa il file del routing) e `docs/runbook.md`. `map-core` e `wm-core` non
  si modificano. Nessun passo negli script della pipeline di wm-tiles.
- Documentazione, commenti e messaggi di log in italiano; identificatori nel
  codice in inglese.
- Ogni strumento geospaziale e Java gira in un container: niente osmium, GDAL
  o Java installati sull'host.
- Sul Mac solo l'area di prova di wm-tiles
  (`/Users/bongiu/Documents/wm-tiles/data/sources/area.osm.pbf`, bbox
  `10.0,43.9,10.9,44.5`); l'area intera solo sul server `ssh wm-tiles`.
- **Area del grafo**: `6.65,35.45,18.55,47.05` (rettangolo del DEM di
  wm-tiles `6.6,35.4,18.6,47.1` con margine interno), ritaglio con strategia
  `complete_ways`.
- **Quote**: PMTiles a un solo livello, **z13**, con
  `graph.elevation.pmtiles.zoom: 13` sempre esplicito.
- Grafo, cache delle quote e grafi precedenti sul **disco locale**, mai sul
  Volume di rete; dati di wm-tiles montati **per cartella**, in sola lettura.
- Grafo **mappato su file** (`graph.dataaccess.default_type: FOREIGN_MMAP`,
  nome del tipo in `config-example.yml:232-241` di GraphHopper).
- **LM** solo su `escursionista` in esercizio; **nessun LM** sulla cella di
  prova e nella preview.
- **Nessuna coordinata nei log**: gateway, Caddy e GraphHopper
  (`server.request_log.appenders: []`, livello `WARN`: `RouteResource.java:157`
  scrive i punti delle richieste GET a livello INFO).
- L'app sceglie solo un profilo. I limiti per richiesta li accetta solo uno
  shard con `limits: true` (la preview).
- Default dell'app: profilo `escursionista`, fino a E.
- Rientro: attivo fra **50 m** e **1000 m a piedi / 2000 m in MTB**; tre
  candidati; verso `forward|backward|nearest` (di serie `forward`).
- GraphHopper di produzione per il confronto: `https://graphhopper.webmapp.it`
  (v7.0, profili `hike`, `bike`, `foot`, CORS `*`).

## Corrispondenza delle difficolta'

Una sola tabella, usata da `prepare/` e dal gateway:

| CAI (`cai_scale`) | `hike_rating` | `sac_scale` scritto |
|---|---|---|
| T, TQ | 1 | `hiking` |
| E | 2 | `mountain_hiking` |
| EE | 3 | `demanding_mountain_hiking` |
| EEA, EEA:F, EEA:PD, EEA:D | 4 | `alpine_hiking` |
| ghiacciaio, via ferrata | 6 | `difficult_alpine_hiking` |
| sconosciuta | 0 | tag tolto |

Regole del pre-passo, in ordine:
1. `highway=via_ferrata` -> 6 (origine `via_ferrata`) e riscritta come
   `highway=path`: GraphHopper la scarta per tutti i profili ("via_ferrata is
   too dangerous", `FootAccessParser.java:112-114`), e solo cosi' `alpinista`
   la puo' usare. Viene prima della regola CAI: una ferrata in una relazione
   EEA (rating 4) altrimenti si aprirebbe a `mtb`;
2. dentro un poligono `natural=glacier` -> 6 (origine `glacier`);
3. massimo di `cai_scale` fra le relazioni `route=hiking|foot` della via e la
   via stessa (origine `cai`);
4. `sac_scale` della via (origine `sac`);
5. altrimenti 0 (origine `none`).

Poi `trail_visibility` `bad|horrible|no` alza di un grado (fino a 6) una
difficolta' gia' nota. Dentro un'area `landuse=military` o con chiave
`military`, la via riceve `access=no`. Le catene di vie `highway=path` con
origine `none` collegate per nodo, lunghe in tutto oltre **500 m**, ricevono
`horse_scale=impossible` (`horse_rating` 6, `OSMHorseRatingParser`).

Soglie dei profili:

| Profilo | `hike_rating` | sconosciuti corti (PATH, rating 0) | catene lunghe (`horse_rating == 6`) |
|---|---|---|---|
| `prudente` | <= 1 | esclusi (TRACK senza tag penalizzato 0,5) | escluse |
| `escursionista` | <= 2 | penalizzati 0,33 | escluse |
| `esperto` | <= 3 | penalizzati 0,33 | penalizzate 0,1 |
| `alpinista` | <= 6 | penalizzati 0,33 | ammesse (0,33) |
| `mtb` | <= 4, `mtb_rating` <= 4 | penalizzati dal profilo mtb | escluse |

## Struttura dei file

```
wm-routing/
  CLAUDE.md                      regole del repo
  README.md
  .gitignore
  docker-compose.yml             engine + gateway
  engine/
    Dockerfile                   GraphHopper compilato da 97f7fde
    config.yml                   esercizio (quote z13, LM su escursionista, MMAP)
    config-cella.yml             come config.yml, senza LM (cella di prova, preview)
    config-fixture.yml           rete sintetica: senza LM, quote dell'area
    profiles/                    foot_base, prudente, escursionista, esperto,
                                 alpinista, mtb, shard-prova
    tests/rete.opl               rete sintetica
    tests/smoke.sh               import + richieste + verifiche
  prepare/
    Dockerfile
    difficulty.py                tabella delle difficolta'
    enrich.py                    PBF -> PBF arricchito + ways.sqlite
    clip.sh                      ritaglio sul rettangolo del grafo
    check-tiles.py               ogni tile z13 toccata dalle vie ha le quote
    tests/test_difficulty.py
    tests/test_enrich.py
  dem/
    Dockerfile
    pack-terrain.py              tile Terrarium z13 di wm-tiles -> terrain.pmtiles
  gateway/
    package.json, Dockerfile
    config/shards.json, config/profiles.json
    src/config.js cors.js rate-limit.js log.js retry.js
    src/difficulty.js time.js engine.js details.js route.js
    src/rejoin/geometry.js src/rejoin/rejoin.js
    src/app.js src/server.js
    test/*.test.js
  preview/index.html, preview/preview.js
  tools/
    bbox.sh                      il rettangolo del grafo, in un solo posto
    data-stamp.sh                data e rettangoli di PBF e PMTiles
    pick-routes.py               percorsi di prova
    compare.mjs                  confronto con la produzione
    gate.mjs                     controllo prima dello scambio
    build-graph.sh               ritaglio, pre-passo, import, controllo, scambio
    check-data.sh                lanciato di notte
    log-check.sh                 nessuna coordinata nei log dei container
    preview-check.mjs
  compare/routes.json, compare/verdicts.json
  infra/pubblica-routing.sh
  docs/runbook.md
  docs/features/routing-escursionistico/{overview,map-core,plan,notes}.md
```

## Review Focus

Cinque casi che la spec implica e che e' facile rompere senza accorgersene. Ogni
riga ha il suo test nel task indicato.

1. **Motore in riavvio durante lo scambio**: il gateway ripete la chiamata fino
   a 60 s e poi risponde; solo oltre i 60 s risponde `503
   {"stato":"riprova"}`, mai `500` (Task 6).
2. **Punti fuori area o invertiti lat/lon**: `400 {"stato":"fuori_area"}`
   prima di chiamare il motore; nessun collegamento: `404
   {"stato":"nessun_percorso", "suggerimento": "<profilo successivo>"}`
   (Task 6).
3. **Richiesta senza `Origin`** (un programma): nessuna intestazione CORS, il
   limite di richieste vale lo stesso (Task 5).
4. **Andata e ritorno sullo stesso sentiero**: con lo stesso punto e due valori
   di `progressM` il rientro sceglie punti diversi, sempre nel verso chiesto;
   un `progressM` oltre la fine si limita alla fine (Task 7).
5. **Coordinate nei log**: una richiesta con una coordinata riconoscibile non
   lascia traccia nei log di gateway e motore (Task 10).

---

### Task 1: Scheletro del repo, motore compilato, rete sintetica

> ⚠️ L'implementazione ha deviato da questo task: [notes.md](notes.md#task-1-scheletro-del-repo)

**Files:**
- Create: `README.md`, `CLAUDE.md`, `.gitignore`
- Create: `engine/Dockerfile`, `engine/tests/rete.opl`

**Interfaces:**
- Produces: immagine `wm-routing-engine:97f7fde` con
  `/app/graphhopper-web.jar`; la rete sintetica `engine/tests/rete.opl`, usata
  anche dai test di `prepare/` (Task 2) e dallo smoke test (Task 3).

- [ ] **Step 1: File di base**

`.gitignore`:

```
node_modules/
data/
*.pbf
*.pmtiles
*.sqlite
compare/risultati/
```

`CLAUDE.md`:

```markdown
# CLAUDE.md

## Lingua

Rispondi in italiano. Documentazione, commenti e log in italiano;
identificatori nel codice in inglese.

## Regole del repo

- **Nessuna coordinata nei log.** Le posizioni mandate per il rientro sono dati
  personali: gateway, Caddy e GraphHopper non registrano corpo, query string o
  punti. Un log nuovo del gateway passa da `gateway/src/log.js`.
  `tools/log-check.sh` lo verifica.
- **Sul Mac solo l'area di prova** di wm-tiles; l'area intera si costruisce sul
  server `ssh wm-tiles`. Sulla cella i profili girano senza LM.
- **I profili cambiano versione quando cambia il loro custom model**:
  `gateway/config/profiles.json` porta l'impronta SHA-256 dei file, e un test
  fallisce se non coincide.
- **wm-routing legge i dati di wm-tiles, non il contrario**: nessun passo negli
  script della pipeline di wm-tiles.
- **`horse_rating` e' un contenitore**: il pre-passo vi scrive le catene di
  sentieri sconosciuti oltre 500 m (`horse_scale=impossible`). Non va mai
  esposto nei dettagli, e un profilo a cavallo non puo' usarlo.
- **`graph.elevation.pmtiles.zoom` sempre esplicito**: senza, GraphHopper usa
  z11 in silenzio.
- Le direttive per l'app sono in
  `docs/features/routing-escursionistico/map-core.md`: `map-core` non si tocca
  finche' non parte lo sviluppo lato app.
```

`README.md`: una pagina con i quattro pezzi (prepare, engine, gateway,
preview), i comandi `docker compose up -d` e `cd gateway && npm test`, e il
rimando a `docs/runbook.md`.

- [ ] **Step 2: Dockerfile del motore**

`engine/Dockerfile`:

```dockerfile
# GraphHopper dal ramo principale a un commit fissato: la sorgente di quote
# `pmtiles` (Terrarium e Mapbox) non c'e' nella 11.1 rilasciata.
FROM maven:3.9-eclipse-temurin-21 AS build
ARG GH_COMMIT=97f7fde
RUN git clone https://github.com/graphhopper/graphhopper.git /src \
 && cd /src && git checkout ${GH_COMMIT}
WORKDIR /src
RUN mvn -q -DskipTests -pl web -am package \
 && cp web/target/graphhopper-web-*.jar /graphhopper-web.jar

FROM eclipse-temurin:21-jre
COPY --from=build /graphhopper-web.jar /app/graphhopper-web.jar
COPY profiles /app/profiles
COPY config.yml config-fixture.yml /app/
WORKDIR /app
ENV JAVA_OPTS="-Xmx2g -Xms2g"
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/graphhopper-web.jar \"$@\"", "--"]
```

Il `COPY` di configurazioni e profili richiede che esistano: si scrivono nei
Task 3 e 4. Fino ad allora si compila con file vuoti (Step 4).

- [ ] **Step 3: Rete sintetica**

`engine/tests/rete.opl`. Punti attorno a 10,0E 44,0N (0,001 gradi di
longitudine sono circa 80 m, di latitudine circa 111 m). Ogni caso ha una sola
via possibile, cosi' ogni verifica dello smoke test dipende da una regola sola.

| Da -> a | Vie | Caso |
|---|---|---|
| A -> B | w1 breve (EE, rete) oppure w2+w3 lunga (T, rete) | difficolta' CAI |
| B -> C | w4, 320 m, nessuna difficolta' | sconosciuto corto |
| A -> K | w14+w15, circa 1,2 km, nessuna difficolta' | catena lunga |
| B -> D | w5 (T) dentro un ghiacciaio | ghiacciaio |
| A -> E | w6 `access=no`, `foot=yes` | accesso a piedi |
| A -> F | w7 `foot=no` | divieto a piedi |
| B -> H | w8 forestale `bicycle=no` | divieto in bici |
| B -> V | w16 `sac_scale=mountain_hiking`, `trail_visibility=bad` | visibilita' |
| A -> M | w11 dentro una zona militare | zona militare |
| B -> Q | w17 `highway=via_ferrata` | via ferrata |

```
n1 v1 x10.000 y44.000 Tname=A
n2 v1 x10.010 y44.000 Tname=B
n3 v1 x10.005 y44.006
n4 v1 x10.014 y44.000 Tname=C
n5 v1 x10.010 y44.008 Tname=D
n6 v1 x10.000 y43.990 Tname=E
n7 v1 x9.990 y44.000 Tname=F
n8 v1 x10.010 y43.990 Tname=H
n9 v1 x9.998 y44.012 Tname=M
n10 v1 x10.016 y43.996 Tname=V
n17 v1 x10.020 y44.004 Tname=Q
n15 v1 x9.995 y44.004
n16 v1 x9.990 y44.008 Tname=K
n21 v1 x10.0085 y44.003
n22 v1 x10.0115 y44.003
n23 v1 x10.0115 y44.009
n24 v1 x10.0085 y44.009
n31 v1 x9.996 y44.006
n32 v1 x10.002 y44.006
n33 v1 x10.002 y44.010
n34 v1 x9.996 y44.010
w1 v1 Thighway=path Nn1,n2
w2 v1 Thighway=path Nn1,n3
w3 v1 Thighway=path Nn3,n2
w4 v1 Thighway=path Nn2,n4
w5 v1 Thighway=path Nn2,n5
w6 v1 Thighway=path,sac_scale=hiking,access=no,foot=yes Nn1,n6
w7 v1 Thighway=path,sac_scale=hiking,foot=no Nn1,n7
w8 v1 Thighway=track,bicycle=no Nn2,n8
w9 v1 Tnatural=glacier Nn21,n22,n23,n24,n21
w10 v1 Tlanduse=military Nn31,n32,n33,n34,n31
w11 v1 Thighway=path,sac_scale=hiking Nn1,n9
w14 v1 Thighway=path Nn1,n15
w15 v1 Thighway=path Nn15,n16
w16 v1 Thighway=path,sac_scale=mountain_hiking,trail_visibility=bad Nn2,n10
w17 v1 Thighway=via_ferrata Nn2,n17
r1 v1 Ttype=route,route=hiking,network=lwn,cai_scale=EE Mw1@
r2 v1 Ttype=route,route=hiking,network=lwn,cai_scale=T Mw2@,w3@,w5@
```

Verifiche geometriche gia' fatte su questi numeri: il ghiacciaio
(x 10.0085-10.0115) contiene w5 (x 10.010) e non tocca w3, che a x 10.0085 sta a
y 44.0018; la zona militare (x 9.996-10.002, y 44.006-44.010) contiene w11 e non
tocca w2 (a y 44.006 e' a x 10.005) ne' w14/w15 (y <= 44.004 per x >= 9.995).
La catena w14+w15 tocca in A solo vie con difficolta' nota, quindi non si
unisce a w4. w4 (B-C) e' l'unica via sconosciuta in B. w17 (ferrata, da B a
x 10.020) a x 10.0115 sta a y 44.0006, fuori dal ghiacciaio. Il poligono
dello shard (Task 3) contiene n3 e quindi chiude w2 e w3 dove si incontrano.

- [ ] **Step 4: Compilare l'immagine**

Run: `touch engine/config.yml engine/config-fixture.yml && mkdir -p engine/profiles && docker build -t wm-routing-engine:97f7fde engine/`
Expected: build riuscita; `docker run --rm wm-routing-engine:97f7fde --help`
elenca i comandi `server` e `import`.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md .gitignore engine/Dockerfile engine/tests/rete.opl
git commit -m "feat(routing-escursionistico): scheletro del repo, motore GraphHopper compilato, rete sintetica"
```

### Task 2: Pre-passo sul PBF (`prepare/`)

> ⚠️ L'implementazione ha deviato da questo task: [notes.md](notes.md#task-2-pre-passo-sul-pbf)

**Files:**
- Create: `prepare/Dockerfile`, `prepare/difficulty.py`, `prepare/enrich.py`,
  `prepare/clip.sh`
- Create: `prepare/tests/test_difficulty.py`, `prepare/tests/test_enrich.py`

**Interfaces:**
- Consumes: `engine/tests/rete.opl` (Task 1), montato in `/fixtures`.
- Produces:
  - `python enrich.py <in.pbf|opl> <out.osm.pbf> <ways.sqlite> [tiles-z13.txt]`,
    stampa un riepilogo JSON su stdout;
  - tabella `ways(way_id INTEGER PRIMARY KEY, cai TEXT, sac TEXT, horse TEXT,
    glacier INTEGER, military INTEGER, visibility TEXT, origin TEXT,
    long_chain INTEGER)`, con `origin` in `via_ferrata`, `glacier`, `cai`,
    `sac`, `none`;
  - `tiles-z13.txt`: una riga `x/y` per ogni tile z13 toccata dai nodi delle
    vie `highway` e da punti ogni 100 m lungo i loro segmenti (GraphHopper
    campiona le quote anche fra i nodi, `long_edge_sampling_distance`);
  - `cai_to_rating(str) -> int|None`, `sac_to_rating(str) -> int|None`,
    `rating_to_sac(int) -> str|None`, `effective(cai_values, own_cai, own_sac,
    glacier, visibility, via_ferrata=False) -> (rating, origin)`;
  - `bash clip.sh <in.pbf> <out.pbf>` (ritaglio sul rettangolo del grafo);
  - immagine `wm-routing-prepare` con `osmium` (CLI), pyosmium, shapely,
    pmtiles.

- [ ] **Step 1: Test della tabella**

`prepare/tests/test_difficulty.py`:

```python
from difficulty import cai_to_rating, sac_to_rating, rating_to_sac

def test_cai():
    assert cai_to_rating("T") == 1
    assert cai_to_rating("TQ") == 1
    assert cai_to_rating("E") == 2
    assert cai_to_rating("EE") == 3
    for v in ("EEA", "EEA:F", "EEA:PD", "EEA:D"):
        assert cai_to_rating(v) == 4
    assert cai_to_rating(" ee ") == 3
    assert cai_to_rating("boh") is None
    assert cai_to_rating(None) is None

def test_sac():
    assert sac_to_rating("hiking") == 1
    assert sac_to_rating("difficult_alpine_hiking") == 6
    assert sac_to_rating("T3") is None

def test_rating_to_sac():
    assert rating_to_sac(2) == "mountain_hiking"
    assert rating_to_sac(6) == "difficult_alpine_hiking"
    assert rating_to_sac(0) is None
```

- [ ] **Step 2: Dockerfile e test che fallisce**

`prepare/Dockerfile`:

```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends osmium-tool \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir osmium==4.0.2 shapely==2.0.6 pmtiles==3.4.1 pytest==8.3.3
WORKDIR /prepare
COPY . /prepare
```

Run: `docker build -t wm-routing-prepare prepare/ && docker run --rm wm-routing-prepare pytest -q tests/test_difficulty.py`
Expected: FAIL con `ModuleNotFoundError: No module named 'difficulty'`.

- [ ] **Step 3: Tabella**

`prepare/difficulty.py`:

```python
"""Corrispondenza fra scala CAI, sac_scale e hike_rating di GraphHopper.

hike_rating e' quello di OSMHikeRatingParser: hiking=1 ... difficult_alpine_hiking=6.
"""

CAI = {"T": 1, "TQ": 1, "E": 2, "EE": 3, "EEA": 4}
SAC = {
    "hiking": 1,
    "mountain_hiking": 2,
    "demanding_mountain_hiking": 3,
    "alpine_hiking": 4,
    "demanding_alpine_hiking": 5,
    "difficult_alpine_hiking": 6,
}
SAC_BY_RATING = {v: k for k, v in SAC.items()}
GLACIER_RATING = 6
POOR_VISIBILITY = {"bad", "horrible", "no"}


def cai_to_rating(value):
    if value is None:
        return None
    v = value.strip().upper()
    if v.startswith("EEA"):  # EEA:F, EEA:PD, EEA:D: la variante non cambia il livello
        return CAI["EEA"]
    return CAI.get(v)


def sac_to_rating(value):
    if value is None:
        return None
    return SAC.get(value.strip())


def rating_to_sac(rating):
    return SAC_BY_RATING.get(rating)
```

Run: `docker build -t wm-routing-prepare prepare/ && docker run --rm wm-routing-prepare pytest -q tests/test_difficulty.py`
Expected: PASS (3 test).

- [ ] **Step 4: Test dell'arricchimento**

`prepare/tests/test_enrich.py`:

```python
import sqlite3

import osmium
import pytest

from enrich import effective, enrich

FIX = "/fixtures/rete.opl"


@pytest.fixture(scope="module")
def result(tmp_path_factory):
    d = tmp_path_factory.mktemp("enrich")
    out, db = d / "out.osm.pbf", d / "ways.sqlite"
    tiles = d / "tiles-z13.txt"
    summary = enrich(FIX, str(out), str(db), str(tiles))
    summary["_tiles"] = set(tiles.read_text().split())
    tags = {w.id: {t.k: t.v for t in w.tags}
            for w in osmium.FileProcessor(str(out), osmium.osm.WAY)}
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    rows = {r["way_id"]: dict(r) for r in con.execute("select * from ways")}
    return tags, rows, summary


def test_cai_from_relation(result):
    tags, rows, _ = result
    assert tags[1]["sac_scale"] == "demanding_mountain_hiking"     # r1 EE
    assert tags[2]["sac_scale"] == "hiking"                        # r2 T
    assert rows[1]["origin"] == "cai" and rows[1]["cai"] == "EE"

def test_unknown_short_and_long(result):
    tags, rows, _ = result
    assert "sac_scale" not in tags[4] and "horse_scale" not in tags[4]    # 320 m
    assert rows[4]["origin"] == "none" and rows[4]["long_chain"] == 0
    for w in (14, 15):                                                    # ~1,2 km
        assert tags[w]["horse_scale"] == "impossible"
        assert rows[w]["long_chain"] == 1

def test_glacier(result):
    tags, rows, _ = result
    assert tags[5]["sac_scale"] == "difficult_alpine_hiking"
    assert rows[5]["glacier"] == 1 and rows[5]["origin"] == "glacier"
    assert tags[3]["sac_scale"] == "hiking"          # w3 fuori dal ghiacciaio

def test_military(result):
    tags, rows, _ = result
    assert tags[11]["access"] == "no" and rows[11]["military"] == 1
    assert "access" not in tags[2]

def test_visibility_raises_one_grade(result):
    tags, rows, _ = result
    assert tags[16]["sac_scale"] == "demanding_mountain_hiking"   # E -> EE
    assert rows[16]["sac"] == "mountain_hiking" and rows[16]["visibility"] == "bad"

def test_via_ferrata(result):
    tags, rows, _ = result
    assert tags[17]["highway"] == "path"
    assert tags[17]["sac_scale"] == "difficult_alpine_hiking"
    assert rows[17]["origin"] == "via_ferrata"

def test_tiles(result):
    _, _, s = result
    assert "4323/2978" in s["_tiles"]          # tile z13 di A (10.000, 44.000)

def test_effective_rules():
    assert effective(["T", "EE"], None, None, False, None) == (3, "cai")
    assert effective([], None, "alpine_hiking", False, None) == (4, "sac")
    assert effective(["boh"], None, None, False, None) == (0, "none")
    assert effective(["E"], None, None, True, None) == (6, "glacier")
    assert effective([], None, "difficult_alpine_hiking", False, "bad") == (6, "sac")
    assert effective([], None, None, False, "bad") == (0, "none")
    assert effective(["EEA"], None, None, False, None, via_ferrata=True) == (6, "via_ferrata")

def test_summary(result):
    _, _, s = result
    assert s["cai_unknown_values"] == {}
    assert s["glaciers"] == 1 and s["military_areas"] == 1
    assert s["long_chains"] == 1
```

Run: `docker build -t wm-routing-prepare prepare/ && docker run --rm -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q tests/test_enrich.py`
Expected: FAIL con `ModuleNotFoundError: No module named 'enrich'`.

- [ ] **Step 5: Arricchimento**

`prepare/enrich.py`:

```python
"""Scrive nel PBF, prima dell'import in GraphHopper, cio' che GraphHopper non
sa ricavare da solo, e salva i valori originali in una tabella laterale.

Tre passate sul file: (1) relazioni escursionistiche e poligoni di ghiacciai e
zone militari; (2) difficolta' effettiva di ogni via e catene di sentieri
sconosciuti; (3) scrittura del PBF arricchito. Regole: piano, "Corrispondenza
delle difficolta'".
"""
import json
import math
import sqlite3
import sys
from collections import Counter, defaultdict

import osmium
from shapely import wkb
from shapely.strtree import STRtree

from difficulty import (GLACIER_RATING, POOR_VISIBILITY, cai_to_rating,
                        rating_to_sac, sac_to_rating)

LONG_CHAIN_M = 500


def effective(cai_values, own_cai, own_sac, glacier, visibility, via_ferrata=False):
    if via_ferrata:
        return GLACIER_RATING, "via_ferrata"
    if glacier:
        return GLACIER_RATING, "glacier"
    ratings = [r for r in (cai_to_rating(v) for v in [*cai_values, own_cai]) if r]
    if ratings:
        rating, origin = max(ratings), "cai"
    else:
        sac = sac_to_rating(own_sac)
        if not sac:
            return 0, "none"
        rating, origin = sac, "sac"
    if visibility in POOR_VISIBILITY:
        rating = min(GLACIER_RATING, rating + 1)
    return rating, origin


def is_military(tags):
    return tags.get("landuse") == "military" or "military" in tags


class Areas(osmium.SimpleHandler):
    """Passata 1: relazioni escursionistiche, ghiacciai, zone militari."""

    def __init__(self):
        super().__init__()
        self.cai_by_way = defaultdict(list)
        self.glaciers, self.military = [], []
        self.unknown_cai = Counter()
        self.factory = osmium.geom.WKBFactory()

    def relation(self, r):
        if r.tags.get("route") not in ("hiking", "foot"):
            return
        cai = r.tags.get("cai_scale")
        if cai is None:
            return
        if cai_to_rating(cai) is None:
            self.unknown_cai[cai] += 1
            return
        for m in r.members:
            if m.type == "w":
                self.cai_by_way[m.ref].append(cai)

    def area(self, a):
        tags = {t.k: t.v for t in a.tags}
        target = (self.glaciers if tags.get("natural") == "glacier"
                  else self.military if is_military(tags) else None)
        if target is None:
            return
        try:
            target.append(wkb.loads(self.factory.create_multipolygon(a), hex=True))
        except RuntimeError:
            pass  # poligono rotto in OSM: si salta


def tile_z13(lon, lat):
    n = 1 << 13
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def segment_tiles(a, b, step_m=100):
    k = math.cos(math.radians((a.lat + b.lat) / 2))
    d = math.hypot((b.lon - a.lon) * k, b.lat - a.lat) * 111_320
    steps = max(1, int(d // step_m))
    for i in range(steps + 1):
        t = i / steps
        yield tile_z13(a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t)


def length_m(nodes):
    d = 0.0
    for a, b in zip(nodes, nodes[1:]):
        k = math.cos(math.radians((a.lat + b.lat) / 2))
        d += math.hypot((b.lon - a.lon) * k, b.lat - a.lat) * 111_320
    return d


class Classify(osmium.SimpleHandler):
    """Passata 2: difficolta' effettiva e catene di sentieri sconosciuti."""

    def __init__(self, areas):
        super().__init__()
        self.areas = areas
        self.glacier_tree = STRtree(areas.glaciers) if areas.glaciers else None
        self.military_tree = STRtree(areas.military) if areas.military else None
        self.factory = osmium.geom.WKBFactory()
        self.info = {}                     # way_id -> riga della tabella laterale
        self.parent = {}                   # union-find sui nodi delle vie sconosciute
        self.unknown_len = {}              # way_id -> (lunghezza, primo nodo)
        self.tiles = set()                 # tile z13 dove GraphHopper chiedera' quote

    def find(self, x):
        while self.parent.setdefault(x, x) != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        self.parent[self.find(a)] = self.find(b)

    def inside(self, tree, w):
        if tree is None:
            return False
        try:
            line = wkb.loads(self.factory.create_linestring(w), hex=True)
        except RuntimeError:
            return False
        return len(tree.query(line, predicate="intersects")) > 0

    def way(self, w):
        tags = {t.k: t.v for t in w.tags}
        if "highway" not in tags:
            return
        nodes = [n for n in w.nodes if n.location.valid()]
        for a, b in zip(nodes, nodes[1:]):
            self.tiles.update(segment_tiles(a, b))
        glacier = self.inside(self.glacier_tree, w)
        military = self.inside(self.military_tree, w)
        via_ferrata = tags.get("highway") == "via_ferrata"
        cai_values = self.areas.cai_by_way.get(w.id, [])
        rating, origin = effective(cai_values, tags.get("cai_scale"), tags.get("sac_scale"),
                                   glacier, tags.get("trail_visibility"), via_ferrata)
        all_cai = cai_values + ([tags["cai_scale"]] if "cai_scale" in tags else [])
        cai = max(all_cai, key=lambda v: cai_to_rating(v) or 0, default=None)
        self.info[w.id] = dict(cai=cai, sac=tags.get("sac_scale"), horse=tags.get("horse_scale"),
                               glacier=int(glacier), military=int(military),
                               visibility=tags.get("trail_visibility"), origin=origin,
                               rating=rating, long_chain=0)
        if origin == "none" and tags.get("highway") == "path":
            ids = [n.ref for n in w.nodes]
            for a, b in zip(ids, ids[1:]):
                self.union(a, b)
            self.unknown_len[w.id] = (length_m(w.nodes), ids[0])

    def mark_long_chains(self):
        total = defaultdict(float)
        for length, first in self.unknown_len.values():
            total[self.find(first)] += length
        long_roots = {r for r, t in total.items() if t > LONG_CHAIN_M}
        for way_id, (_, first) in self.unknown_len.items():
            if self.find(first) in long_roots:
                self.info[way_id]["long_chain"] = 1
        return len(long_roots)


class Write(osmium.SimpleHandler):
    """Passata 3: PBF arricchito."""

    def __init__(self, info, writer):
        super().__init__()
        self.info, self.writer = info, writer

    def node(self, n):
        self.writer.add_node(n)

    def relation(self, r):
        self.writer.add_relation(r)

    def way(self, w):
        i = self.info.get(w.id)
        if i is None:
            self.writer.add_way(w)
            return
        tags = {t.k: t.v for t in w.tags}
        sac = rating_to_sac(i["rating"])
        if sac:
            tags["sac_scale"] = sac
        else:
            tags.pop("sac_scale", None)
        tags.pop("horse_scale", None)       # l'originale sta nella tabella laterale
        if i["origin"] == "via_ferrata":
            tags["highway"] = "path"        # GraphHopper scarta via_ferrata per tutti i profili
        if i["long_chain"]:
            tags["horse_scale"] = "impossible"
        if i["military"]:
            tags["access"] = "no"
        self.writer.add_way(w.replace(tags=tags))


def enrich(src, dst, db_path, tiles_path=None):
    areas = Areas()
    areas.apply_file(src, locations=True)
    classify = Classify(areas)
    classify.apply_file(src, locations=True)
    long_chains = classify.mark_long_chains()

    db = sqlite3.connect(db_path)
    db.execute("drop table if exists ways")
    db.execute("create table ways (way_id integer primary key, cai text, sac text, horse text,"
               " glacier integer, military integer, visibility text, origin text, long_chain integer)")
    db.executemany("insert into ways values (?,?,?,?,?,?,?,?,?)",
                   ((k, v["cai"], v["sac"], v["horse"], v["glacier"], v["military"],
                     v["visibility"], v["origin"], v["long_chain"]) for k, v in classify.info.items()))
    db.commit()
    db.close()

    writer = osmium.SimpleWriter(dst, overwrite=True)
    try:
        Write(classify.info, writer).apply_file(src)
    finally:
        writer.close()

    if tiles_path:
        with open(tiles_path, "w") as f:
            f.writelines(f"{x}/{y}\n" for x, y in sorted(classify.tiles))

    origins = Counter(v["origin"] for v in classify.info.values())
    return {"ways": len(classify.info), **origins, "glaciers": len(areas.glaciers),
            "military_areas": len(areas.military), "long_chains": long_chains,
            "horse_scale_originali": sum(1 for v in classify.info.values() if v["horse"]),
            "tiles_z13": len(classify.tiles),
            "cai_unknown_values": dict(areas.unknown_cai)}


if __name__ == "__main__":
    if len(sys.argv) not in (4, 5):
        sys.exit("uso: enrich.py <in.pbf> <out.osm.pbf> <ways.sqlite> [tiles-z13.txt]")
    s = enrich(*sys.argv[1:])
    print(json.dumps(s, ensure_ascii=False))
    if s["cai_unknown_values"]:
        print("!! valori di cai_scale fuori tabella:", s["cai_unknown_values"], file=sys.stderr)
```

Nota per l'area intera: `info` e `parent` stanno in memoria (milioni di vie e
nodi). Lo Step 7 misura la memoria sull'area di prova e il Task 11 sul server.
Se pesa troppo, `parent` e `info` passano a SQLite: e' un cambio locale a
`Classify`.

Run: `docker build -t wm-routing-prepare prepare/ && docker run --rm -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q`
Expected: PASS (tutti i test).

- [ ] **Step 6: Ritaglio sul rettangolo del grafo** (dopo la misura dello Step 7:
  conviene lanciare prima lo Step 7, che dice subito se `info` e `parent`
  stanno in memoria)

`prepare/clip.sh`:

```bash
#!/usr/bin/env bash
# Ritaglia il PBF sul rettangolo del DEM di wm-tiles con un margine interno:
# fuori dal DEM GraphHopper non ha quote. complete_ways tiene intere le vie al
# bordo, e con loro le relazioni escursionistiche che le contengono.
set -euo pipefail
BBOX="${WM_GRAPH_BBOX:?serve WM_GRAPH_BBOX, da tools/bbox.sh}"
osmium extract --bbox "$BBOX" --strategy complete_ways --set-bounds \
  --overwrite -o "$2" "$1"
```

Il rettangolo non ha un default nello script: viene da `tools/bbox.sh`
(Task 10), l'unico posto in cui e' scritto. Prova su un sotto-rettangolo
dell'area:

```bash
docker run --rm -e WM_GRAPH_BBOX=10.2,44.0,10.5,44.2 \
  -v /Users/bongiu/Documents/wm-tiles/data/sources:/in:ro -v "$PWD/data":/out wm-routing-prepare \
  bash -c 'bash clip.sh /in/area.osm.pbf /out/ritaglio.osm.pbf && osmium tags-count /out/ritaglio.osm.pbf -t r route=hiking'
```

Expected: un numero di relazioni `route=hiking` maggiore di zero, e le vie al
bordo intere (`osmium fileinfo -e /out/ritaglio.osm.pbf` riporta un
rettangolo dei dati piu' largo di quello chiesto, perche' `complete_ways`
tiene i nodi esterni delle vie tagliate).

- [ ] **Step 7: Sull'area di prova**

Run:

```bash
mkdir -p data && docker run --rm -v /Users/bongiu/Documents/wm-tiles/data/sources:/in:ro \
  -v "$PWD/data":/out wm-routing-prepare \
  python enrich.py /in/area.osm.pbf /out/arricchito.osm.pbf /out/ways.sqlite /out/tiles-z13.txt
```

L'area di prova sta tutta dentro il rettangolo del grafo, quindi qui il
ritaglio non serve. Expected: riepilogo JSON con `cai` intorno a qualche
migliaio, `glaciers: 0`, `cai_unknown_values: {}`. Annotare in `notes.md`
(sezione "Misure", creata nel Task 4) i numeri, il tempo e la memoria massima
del container (`docker stats` in un altro terminale).

- [ ] **Step 8: Commit**

```bash
git add prepare/
git commit -m "feat(routing-escursionistico): pre-passo sul PBF con difficolta' CAI, catene di sconosciuti, ghiacciai e zone militari"
```

### Task 3: Profili e motore sulla rete sintetica

> ⚠️ L'implementazione ha deviato da questo task: [notes.md](notes.md#task-3-profili-e-motore-sulla-rete-sintetica)

**Files:**
- Create: `engine/profiles/foot_base.json`, `prudente.json`, `escursionista.json`,
  `esperto.json`, `alpinista.json`, `mtb.json`, `shard-prova.json`
- Create: `engine/config-fixture.yml`, `engine/tests/smoke.sh`

**Interfaces:**
- Consumes: `wm-routing-prepare` (Task 2), `wm-routing-engine:97f7fde` (Task 1).
- Produces: profili del motore `prudente`, `escursionista`, `esperto`,
  `alpinista`, `mtb`, `prova--escursionista`; parametri lato server
  `max_hike_rating`, `max_slope`, `max_mtb_rating`.

- [ ] **Step 0: Quote dell'area di prova**

Il motore vuole una sorgente di quote anche per la rete sintetica (Step 3):
eseguire qui il Task 4, Step 1 (`dem/`, `pack-terrain.py`), che produce
`data/terrain.pmtiles` sull'area di prova.

- [ ] **Step 1: Il test del motore**

`engine/tests/smoke.sh`:

```bash
#!/usr/bin/env bash
# Costruisce la rete sintetica, la importa e verifica le scelte dei profili.
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE="${WM_ENGINE_IMAGE:-wm-routing-engine:97f7fde}"
T=$(mktemp -d)
trap 'docker rm -f wm-engine-smoke >/dev/null 2>&1 || true; rm -rf "$T"' EXIT

# la rete sta in mare davanti alla costa apuana: quote 0, pendenza 0, ma
# GraphHopper vuole comunque una sorgente di quote per average_slope
# (GraphHopper.java:1017)
cp ../data/terrain.pmtiles "$T/terrain.pmtiles"
docker run --rm -v "$PWD/tests":/in:ro -v "$T":/out wm-routing-prepare \
  python enrich.py /in/rete.opl /out/rete.osm.pbf /out/ways.sqlite >/dev/null
docker run --rm -v "$T":/data "$IMAGE" import config-fixture.yml
docker run -d --name wm-engine-smoke -p 127.0.0.1:18988:8989 -v "$T":/data \
  "$IMAGE" server config-fixture.yml >/dev/null
for i in $(seq 60); do curl -fs localhost:18988/health >/dev/null && break; sleep 1; done

route() { # $1 profilo, $2 da, $3 a -> distanza in metri, oppure "nessuno"
  curl -s localhost:18988/route -H 'Content-Type: application/json' -d \
    "{\"profile\":\"$1\",\"points\":[$2,$3],\"points_encoded\":false}" \
  | jq -r 'if .paths then (.paths[0].distance|floor) else "nessuno" end'
}
A='[10.000,44.000]'; B='[10.010,44.000]'; C='[10.014,44.000]'; D='[10.010,44.008]'
E='[10.000,43.990]'; F='[9.990,44.000]'; H='[10.010,43.990]'; K='[9.990,44.008]'
M='[9.998,44.012]'; V='[10.016,43.996]'; Q='[10.020,44.004]'
fail=0
ok()   { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (atteso $3, avuto $2)"; fail=1; fi; }
some() { if [ "$2" != nessuno ]; then echo "ok   $1"; else echo "FAIL $1 (nessun percorso)"; fail=1; fi; }
lt()   { if [ "$2" != nessuno ] && [ "$2" -lt "$3" ]; then echo "ok   $1"; else echo "FAIL $1 ($2)"; fail=1; fi; }
gt()   { if [ "$2" != nessuno ] && [ "$2" -gt "$3" ]; then echo "ok   $1"; else echo "FAIL $1 ($2)"; fail=1; fi; }

lt   "esperto prende la via breve EE"           "$(route esperto "$A" "$B")" 1000
gt   "escursionista evita la via EE"            "$(route escursionista "$A" "$B")" 1400
gt   "prudente passa sul T"                     "$(route prudente "$A" "$B")" 1400
some "escursionista usa il collegamento corto"  "$(route escursionista "$B" "$C")"
ok   "prudente esclude lo sconosciuto"          "$(route prudente "$B" "$C")" nessuno
ok   "escursionista esclude la catena lunga"    "$(route escursionista "$A" "$K")" nessuno
some "esperto ammette la catena lunga"          "$(route esperto "$A" "$K")"
ok   "esperto non entra nel ghiacciaio"         "$(route esperto "$B" "$D")" nessuno
some "alpinista entra nel ghiacciaio"           "$(route alpinista "$B" "$D")"
some "access=no + foot=yes e' aperto a piedi"   "$(route escursionista "$A" "$E")"
ok   "foot=no e' chiuso a piedi"                "$(route escursionista "$A" "$F")" nessuno
ok   "bicycle=no e' chiuso in mtb"              "$(route mtb "$B" "$H")" nessuno
some "bicycle=no e' aperto a piedi"             "$(route escursionista "$B" "$H")"
ok   "visibilita' cattiva: E diventa EE"        "$(route escursionista "$B" "$V")" nessuno
some "visibilita' cattiva: esperto passa"       "$(route esperto "$B" "$V")"
ok   "zona militare chiusa"                     "$(route alpinista "$A" "$M")" nessuno
ok   "via ferrata chiusa all'esperto"           "$(route esperto "$B" "$Q")" nessuno
ok   "via ferrata chiusa in mtb"                "$(route mtb "$B" "$Q")" nessuno
some "via ferrata aperta all'alpinista"         "$(route alpinista "$B" "$Q")"
ok   "l'area dello shard chiude la via T, e la EE resta vietata" \
                                                "$(route prova--escursionista "$A" "$B")" nessuno
exit $fail
```

Run: `chmod +x engine/tests/smoke.sh && engine/tests/smoke.sh`
Expected: FAIL nell'import, perche' `config-fixture.yml` e i profili sono vuoti.

- [ ] **Step 2: I profili**

`engine/profiles/foot_base.json` (comune ai quattro profili a piedi). Non
dichiara parametri: GraphHopper rifiuta un parametro gia' definito in un file
precedente dello stesso profilo (`GraphHopper.java:1793-1796`), quindi
`max_hike_rating` e `max_slope` li dichiara ogni profilo, e le regole qui li
usano come `p_max_hike_rating` e `p_max_slope`:

```json
{
  "priority": [
    { "if": "!foot_access || hike_rating > p_max_hike_rating", "multiply_by": "0" },
    { "else": "", "multiply_by": "foot_priority" },
    { "if": "average_slope > p_max_slope || average_slope < -p_max_slope", "multiply_by": "0" },
    { "if": "foot_network != MISSING", "multiply_by": "1.5" },
    { "else_if": "road_class == PATH && hike_rating > 0", "multiply_by": "0.67" },
    { "else_if": "road_class == PATH && hike_rating == 0", "multiply_by": "0.33" },
    { "if": "road_class == PRIMARY || road_class == SECONDARY || road_class == TRUNK", "multiply_by": "0.3" },
    { "if": "surface == ASPHALT", "multiply_by": "0.8" },
    { "if": "road_environment == FERRY", "multiply_by": "0.5" }
  ],
  "speed": [
    { "if": "road_environment == FERRY", "limit_to": "ferry_speed" },
    { "else_if": "hike_rating < 1", "limit_to": "foot_average_speed" },
    { "else_if": "hike_rating > 2", "limit_to": "1.5" },
    { "else": "", "limit_to": "4" },
    { "if": "average_slope >= 15", "limit_to": "1.5" },
    { "else_if": "average_slope >= 7", "limit_to": "2.5" }
  ]
}
```

I moltiplicatori 1,5 / 0,67 / 0,33 sono i tre livelli del modello (rete CAI,
fuori rete con difficolta', difficolta' sconosciuta): una penalita' sulla
priorita' costa in proporzione alla lunghezza del tratto. Sono valori di
partenza, da tarare con la preview. Lo `speed` serve a scegliere il percorso;
il tempo mostrato a piedi lo calcola il gateway con la DIN (Task 6).

`escursionista.json`:

```json
{
  "parameters": { "max_hike_rating": 2, "max_slope": 100 },
  "priority": [ { "if": "horse_rating == 6", "multiply_by": "0" } ]
}
```

`esperto.json`:

```json
{
  "parameters": { "max_hike_rating": 3, "max_slope": 100 },
  "priority": [ { "if": "horse_rating == 6", "multiply_by": "0.1" } ]
}
```

`alpinista.json`: `{ "parameters": { "max_hike_rating": 6, "max_slope": 100 } }`.

`prudente.json` (fino a T, sconosciuti esclusi sui sentieri e penalizzati sulle
forestali, pendenze severe):

```json
{
  "parameters": { "max_hike_rating": 1, "max_slope": 25 },
  "priority": [
    { "if": "road_class == PATH && hike_rating == 0", "multiply_by": "0" },
    { "if": "road_class == TRACK && hike_rating == 0", "multiply_by": "0.5" },
    { "if": "horse_rating == 6", "multiply_by": "0" }
  ]
}
```

`mtb.json` (parte da
`core/src/main/resources/com/graphhopper/custom_models/mtb.json` di
GraphHopper):

```json
{
  "parameters": { "max_mtb_rating": 4, "max_hike_rating": 4 },
  "priority": [
    { "if": "true", "multiply_by": "mtb_priority" },
    { "if": "mtb_network != MISSING || bike_network != MISSING", "multiply_by": "1.3" },
    { "if": "mtb_rating > p_max_mtb_rating", "multiply_by": "0" },
    { "if": "hike_rating > p_max_hike_rating", "multiply_by": "0" },
    { "if": "horse_rating == 6", "multiply_by": "0" },
    { "if": "road_class == STEPS", "multiply_by": "0" },
    { "if": "get_off_bike", "multiply_by": "0.2" },
    { "if": "bike_road_access == NO", "multiply_by": "0" },
    { "if": "!mtb_access && (!backward_mtb_access || roundabout)", "multiply_by": "0" },
    { "else_if": "!mtb_access && backward_mtb_access", "multiply_by": "0.5" },
    { "if": "road_environment == FERRY", "multiply_by": "0.5" }
  ],
  "speed": [
    { "if": "road_environment == FERRY", "limit_to": "ferry_speed" },
    { "else": "", "limit_to": "mtb_average_speed" },
    { "if": "get_off_bike", "limit_to": "4" }
  ]
}
```

`shard-prova.json` (esempio di profilo per shard: una zona chiusa dall'ente
come area, `docs/core/custom-models.md`, sezione "areas", righe 482-531):

```json
{
  "areas": {
    "type": "FeatureCollection",
    "features": [{
      "type": "Feature", "id": "chiuso1", "properties": {},
      "geometry": { "type": "Polygon", "coordinates": [[
        [10.0045, 44.0055], [10.0055, 44.0055], [10.0055, 44.0065], [10.0045, 44.0065], [10.0045, 44.0055]
      ]] }
    }]
  },
  "priority": [ { "if": "in_chiuso1", "multiply_by": "0" } ]
}
```

L'area contiene n3 e chiude w2 e w3 dove si incontrano: per
`prova--escursionista` la via lunga T fra A e B si interrompe, la breve EE resta vietata (fino a E), quindi
A -> B non ha percorso (ultima riga dello smoke test).

- [ ] **Step 3: Configurazione per la rete sintetica**

`engine/config-fixture.yml` (senza LM; quote dal PMTiles dell'area di prova,
impacchettato nello Step 0):

```yaml
graphhopper:
  datareader.file: /data/rete.osm.pbf
  graph.location: /data/graph
  graph.dataaccess.default_type: FOREIGN_MMAP
  graph.elevation.provider: pmtiles
  graph.elevation.pmtiles.location: /data/terrain.pmtiles
  graph.elevation.pmtiles.zoom: 13
  graph.elevation.cache_dir: /data/quote-cache
  custom_models.directory: /app/profiles
  graph.encoded_values: |
    foot_access, foot_priority, foot_network, foot_average_speed, foot_road_access,
    hike_rating, horse_rating, average_slope, ferry_speed, road_class, road_environment,
    surface, mtb_access, mtb_priority, mtb_average_speed, mtb_network, bike_network,
    mtb_rating, bike_road_access, get_off_bike, roundabout, osm_way_id
  profiles:
    - { name: prudente,      custom_model_files: [foot_base.json, prudente.json] }
    - { name: escursionista, custom_model_files: [foot_base.json, escursionista.json] }
    - { name: esperto,       custom_model_files: [foot_base.json, esperto.json] }
    - { name: alpinista,     custom_model_files: [foot_base.json, alpinista.json] }
    - { name: mtb,           custom_model_files: [mtb.json] }
    - { name: prova--escursionista, custom_model_files: [foot_base.json, escursionista.json, shard-prova.json] }
  profiles_lm: []
  import.osm.ignored_highways: motorway,trunk
server:
  application_connectors:
    - { type: http, port: 8989, bind_host: 0.0.0.0 }
  request_log:
    appenders: []
  admin_connectors:
    - { type: http, port: 8990, bind_host: 127.0.0.1 }
logging:
  level: WARN
  loggers:
    "com.graphhopper.http": INFO
  appenders:
    - type: console
```

Le chiavi `server.request_log` e `logging` sono quelle di
`config-example.yml:270-295` di GraphHopper. `com.graphhopper.http` a INFO
serve solo alla riga `loaded graph at:...` di `GraphHopperManaged.java:44`
(nodi del grafo); le richieste le scrive `com.graphhopper.resources`, che resta
a WARN (`RouteResource.java:157` scrive i punti delle GET). La rete sintetica
sta in mare: quote 0, `average_slope` 0, le regole sulla pendenza non
intervengono; `max_slope` di `prudente` si verifica nel Task 4.

- [ ] **Step 4: Ricompilare e lanciare il test**

Run: `docker build -t wm-routing-engine:97f7fde engine/ && engine/tests/smoke.sh`
Expected: venti righe `ok`, uscita 0. Se una riga sull'accesso fallisce,
il parser di GraphHopper non segue la regola dell'overview: si corregge con una
riga nel custom model (per esempio `{ "if": "foot_road_access == NO",
"multiply_by": "0" }`) e si annota in `notes.md`. Se all'avvio un nome di
encoded value e' rifiutato, GraphHopper stampa quelli validi: si usa il nome
indicato e lo si annota.

- [ ] **Step 5: Commit**

```bash
git add engine/
git commit -m "feat(routing-escursionistico): cinque profili escursionistici e test sulla rete sintetica"
```

### Task 4: Quote a z13 e misure sull'area di prova

> ⚠️ L'implementazione ha deviato da questo task: [notes.md](notes.md#task-4-quote-a-z13-e-misure)

**Files:**
- Create: `dem/Dockerfile`, `dem/pack-terrain.py`
- Create: `engine/config.yml`, `engine/config-cella.yml`
- Create: `docs/features/routing-escursionistico/notes.md`

**Interfaces:**
- Consumes: tile Terrarium di wm-tiles in `<cartella>/13/{x}/{y}.png`
  (localmente `/Users/bongiu/Documents/wm-tiles/data/dem/terrain`, sul server
  `/data/wm-tiles/dem/terrain`).
- Produces: `terrain.pmtiles` (z13, PNG Terrarium); `engine/config.yml`.

- [ ] **Step 1: Impacchettare le tile**

`dem/Dockerfile`:

```dockerfile
FROM python:3.12-slim
RUN pip install --no-cache-dir pmtiles==3.4.1
WORKDIR /dem
COPY pack-terrain.py /dem/
```

`dem/pack-terrain.py`:

```python
"""Raccoglie le tile Terrarium di wm-tiles di un solo livello in un PMTiles per
GraphHopper, che legge le quote da un livello solo (PMTilesElevationProvider,
riga 168). Stesse quote dell'ombreggiatura, nessun ricampionamento.

Uso: pack-terrain.py <cartella z/x/y.png> <out.pmtiles> <z> <W,S,E,N>
"""
import os
import sys

from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

src, dst, z = sys.argv[1], sys.argv[2], int(sys.argv[3])
w, s, e, n = (float(v) for v in sys.argv[4].split(","))
zdir = os.path.join(src, str(z))
if not os.path.isdir(zdir):
    sys.exit(f"!! manca il livello {z} in {src}")
tiles = sorted(
    (zxy_to_tileid(z, int(x), int(name[:-4])), os.path.join(zdir, x, name))
    for x in os.listdir(zdir) for name in os.listdir(os.path.join(zdir, x)) if name.endswith(".png"))
if not tiles:
    sys.exit(f"!! nessuna tile in {zdir}")
with open(dst, "wb") as f:
    wr = Writer(f)
    for tid, path in tiles:
        with open(path, "rb") as t:
            wr.write_tile(tid, t.read())
    wr.finalize(
        {"tile_type": TileType.PNG, "tile_compression": Compression.NONE,
         "min_zoom": z, "max_zoom": z,
         "min_lon_e7": int(w * 1e7), "min_lat_e7": int(s * 1e7),
         "max_lon_e7": int(e * 1e7), "max_lat_e7": int(n * 1e7),
         "center_zoom": z, "center_lon_e7": int((w + e) / 2 * 1e7),
         "center_lat_e7": int((s + n) / 2 * 1e7)},
        {"encoding": "terrarium", "attribution": "TINITALY, Copernicus GLO-30"})
print(f"{len(tiles)} tile z{z} scritte in {dst}")
```

Run:

```bash
docker build -t wm-routing-dem dem/ && docker run --rm \
  -v /Users/bongiu/Documents/wm-tiles/data/dem/terrain:/in:ro -v "$PWD/data":/out \
  wm-routing-dem python pack-terrain.py /in /out/terrain.pmtiles 13 10.0,43.9,10.9,44.5
```

Expected: `N tile z13 scritte in /out/terrain.pmtiles`, con N > 0.

- [ ] **Step 2: Configurazione di esercizio**

`engine/config.yml`: uguale a `config-fixture.yml` tranne queste chiavi:

```yaml
  datareader.file: /data/arricchito.osm.pbf
  graph.location: /graph/graph
  graph.elevation.provider: pmtiles
  graph.elevation.pmtiles.location: /data/terrain.pmtiles
  graph.elevation.pmtiles.zoom: 13
  graph.elevation.cache_dir: /graph/quote-cache
  graph.elevation.interpolate: bilinear
  graph.elevation.long_edge_sampling_distance: 60
  graph.elevation.way_point_max_distance: 10
  graph.elevation.edge_smoothing: moving_average
  graph.elevation.edge_smoothing.moving_average.window_size: 150
  profiles_lm:
    - profile: escursionista
  prepare.lm.landmarks: 16
```

Le chiavi delle quote sono quelle di `config-example.yml:143-161` di
GraphHopper. `engine/config-cella.yml` e' identico a `config.yml` tranne
`profiles_lm: []`: la cella di prova e la preview girano senza LM, come vuole
l'overview. Una lista non si sostituisce con un override `-Ddw.` di Dropwizard
(sostituisce un nodo con una stringa), per questo e' un file a parte, scelto
dagli script con `WM_ENGINE_CONFIG`.

Server e controllo prima dello scambio aprono il grafo in sola lettura con
`-Ddw.graphhopper.graph.read_only=true` (uno scalare: l'override funziona):
senza, GraphHopper crea `gh.lock` nella cartella del grafo
(`GraphHopper.java:829-835`) e su un montaggio `:ro` non parte. L'import usa
`config.yml` cosi' com'e', in scrittura.

- [ ] **Step 3: Import dell'area di prova e verifica delle quote**

Run:

```bash
mkdir -p data/graph
mkdir -p data/graph/quote-cache
docker run --rm -e JAVA_OPTS="-Xmx3g" \
  -v "$PWD/data":/data -v "$PWD/data/graph":/graph wm-routing-engine:97f7fde import config-cella.yml
docker run -d --name wm-engine-area -p 127.0.0.1:18989:8989 \
  -e JAVA_OPTS="-Xmx3g -Ddw.graphhopper.graph.read_only=true" \
  -v "$PWD/data":/data:ro -v "$PWD/data/graph":/graph:ro wm-routing-engine:97f7fde server config-cella.yml
for i in $(seq 120); do curl -fs localhost:18989/health >/dev/null && break; sleep 1; done
curl -s localhost:18989/route -H 'Content-Type: application/json' -d \
  '{"profile":"escursionista","points":[[10.2335,44.0490],[10.2617,44.0253]],"points_encoded":false,"elevation":true}' \
  | jq '{d: .paths[0].distance, su: .paths[0].ascend, giu: .paths[0].descend, quote: ([.paths[0].points.coordinates[][2]] | [min, max])}'
```

Expected: quote fra 0 e 2000 m, che salgono e scendono in modo coerente lungo
il percorso (dal Passo del Vestito al Rifugio del Freo, Apuane). Quote tutte a
zero o di decine di migliaia di metri vogliono dire che GraphHopper non sta
leggendo Terrarium: si apre `PMTilesElevationProvider.java` al commit
`97f7fde` per vedere come sceglie `TerrainEncoding` (chiave
`graph.elevation.pmtiles.terrain_encoding`, `GraphHopper.java:727-734`) e lo si
annota.

Verifica della pendenza: lo stesso percorso con `prudente` (`max_slope` 25)
deve risultare piu' lungo di quello con `escursionista`, oppure dare nessun
percorso. Se sono identici, la regola sulla pendenza non agisce: si
controllano i valori di `average_slope` nei dettagli e lo si annota. Il
container `wm-engine-area` resta acceso per i Task 6-9.

- [ ] **Step 4: Misure da annotare in `notes.md`**

Creare `docs/features/routing-escursionistico/notes.md` con le sezioni
"Deviazioni dal piano", "Bug trovati", "Decisioni", "Follow-up", "Misure". In
"Misure", per l'area di prova:
- tempo e memoria massima del pre-passo (Task 2) e dell'import (`docker stats`);
- spazio su disco del grafo e della cache delle quote (`data/graph/quote-cache`);
- numero di nodi del grafo (riga `loaded graph at:...` del log di avvio,
  `GraphHopperManaged.java:44`);
- salita e discesa di tre percorsi confrontate con tracce GPS note o con il
  profilo altimetrico di wm-tiles: con `moving_average` a 150 m, a 300 m e
  senza levigatura;
- lo stesso percorso con `pmtiles.zoom: 14` (PMTiles rifatto a z14), per
  vedere se il dislivello cambia oltre l'1%;
- una prova con LM su `escursionista` (import con `config.yml` invece di
  `config-cella.yml`): spazio dei file `landmarks_*`.

Da questi numeri si stima, in proporzione ai nodi, la memoria residente per
l'area intera, e la si scrive in `notes.md` **prima del Task 11** con il
criterio di stop: se la stima supera 20 GB residenti, nessun profilo con LM e
`prepare.lm.landmarks` ridotto; altrimenti LM su `escursionista` e, se avanza,
su `mtb`. In "Follow-up" va anche la nota di taratura: `max_hike_rating: 4` di
`mtb` (ereditato da `mtb.json` di GraphHopper) apre alle bici i sentieri EEA a
piedi, da rivedere con la preview.

- [ ] **Step 5: Commit**

```bash
git add dem/ engine/config.yml docs/features/routing-escursionistico/notes.md
git commit -m "feat(routing-escursionistico): quote dal DEM di wm-tiles a z13 via PMTiles, misure sull'area di prova"
```

### Task 5: Gateway, configurazione, CORS, limite di richieste, log

**Files:**
- Create: `gateway/package.json`, `gateway/config/shards.json`,
  `gateway/config/profiles.json`
- Create: `gateway/src/config.js`, `cors.js`, `rate-limit.js`, `log.js`,
  `app.js`, `server.js`
- Test: `gateway/test/config.test.js`, `cors.test.js`, `rate-limit.test.js`,
  `log.test.js`, `app.test.js`

**Interfaces:**
- Produces:
  - `loadConfig(dir) -> {shards, profiles}`, con
    `shards[id] = {profiles: {nomePubblico: profiloMotore}, origins: string[], limits: bool, rate: {capacity, perSecond}}`
    e `profiles[profiloMotore] = {mode: 'foot'|'mtb', version: string, sha256: string, files: string[], next?: string}`;
  - `corsHeaders(shard, origin) -> object|null`;
  - `createRateLimiter({capacity, perSecond, now}) -> {take(key) -> boolean}`;
  - `logEvent(fields)`: JSON su stdout con i soli campi ammessi;
  - `createApp({config, dataStamp, handlers}) -> express app`, con
    `handlers = {route?, rejoin?}`.

- [ ] **Step 1: package.json e configurazioni**

Prima di fissare le versioni, verificare che esistano: `npm view express
version`, `npm view vitest version`, `npm view supertest version`, `npm view
better-sqlite3 version`, `npm view playwright version`, e per il Python `pip
index versions pmtiles` (lo stesso per osmium, shapely, pytest): un `^` su una
versione inesistente fa fallire `npm install` (ETARGET). Si scrivono quelle
trovate.

`gateway/package.json`:

```json
{
  "name": "wm-routing-gateway",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "start": "node src/server.js" },
  "dependencies": { "better-sqlite3": "^11.3.0", "express": "^5.2.1" },
  "devDependencies": { "playwright": "1.61.1", "supertest": "^7.2.2", "vitest": "^3.2.7" }
}
```

`gateway/config/shards.json`:

```json
{
  "webmapp": {
    "profiles": {
      "prudente": "prudente", "escursionista": "escursionista",
      "esperto": "esperto", "alpinista": "alpinista", "mtb": "mtb"
    },
    "origins": ["https://webmapp.it"],
    "limits": false,
    "rate": { "capacity": 60, "perSecond": 1 }
  },
  "preview": {
    "profiles": {
      "prudente": "prudente", "escursionista": "escursionista",
      "esperto": "esperto", "alpinista": "alpinista", "mtb": "mtb",
      "prova--escursionista": "prova--escursionista"
    },
    "origins": ["http://localhost:8991", "https://routing.maphub.it"],
    "limits": true,
    "rate": { "capacity": 120, "perSecond": 4 }
  }
}
```

Le origini reali di ogni shard (webapp, siti con il widget, WebView delle app:
`capacitor://localhost` su iOS, `http://localhost` su Android) si aggiungono
prima che le app nuove lo usino.

`gateway/config/profiles.json` (le impronte si calcolano nello Step 4; `next`
e' il profilo da suggerire quando non c'e' un percorso):

```json
{
  "prudente":      { "mode": "foot", "version": "1", "next": "escursionista", "files": ["foot_base.json", "prudente.json"], "sha256": "" },
  "escursionista": { "mode": "foot", "version": "1", "next": "esperto", "files": ["foot_base.json", "escursionista.json"], "sha256": "" },
  "esperto":       { "mode": "foot", "version": "1", "next": "alpinista", "files": ["foot_base.json", "esperto.json"], "sha256": "" },
  "alpinista":     { "mode": "foot", "version": "1", "files": ["foot_base.json", "alpinista.json"], "sha256": "" },
  "mtb":           { "mode": "mtb",  "version": "1", "files": ["mtb.json"], "sha256": "" },
  "prova--escursionista": { "mode": "foot", "version": "1", "files": ["foot_base.json", "escursionista.json", "shard-prova.json"], "sha256": "" }
}
```

- [ ] **Step 2: Test**

`gateway/test/config.test.js`:

```js
import {describe, it, expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadConfig} from '../src/config.js';

const CONF = new URL('../config', import.meta.url).pathname;
const PROFILES = new URL('../../engine/profiles', import.meta.url).pathname;

describe('configurazione', () => {
  it('ogni profilo pubblico di uno shard esiste fra i profili del motore', () => {
    const {shards, profiles} = loadConfig(CONF);
    for (const s of Object.values(shards))
      for (const engine of Object.values(s.profiles)) expect(profiles[engine]).toBeDefined();
  });
  it("l'impronta di ogni profilo coincide con i suoi custom model: cambiarli vuol dire cambiare versione", () => {
    const {profiles} = loadConfig(CONF);
    for (const [name, p] of Object.entries(profiles)) {
      const h = createHash('sha256');
      for (const f of p.files) h.update(readFileSync(join(PROFILES, f)));
      expect(p.sha256, `aggiorna sha256 e version di ${name}`).toBe(h.digest('hex'));
    }
  });
});
```

`gateway/test/cors.test.js`:

```js
import {it, expect} from 'vitest';
import {corsHeaders} from '../src/cors.js';

const shard = {origins: ['https://parco-x.it']};
it("un'origine in lista riceve le intestazioni", () => {
  expect(corsHeaders(shard, 'https://parco-x.it')['Access-Control-Allow-Origin']).toBe('https://parco-x.it');
});
it("un'origine fuori lista non le riceve", () => {
  expect(corsHeaders(shard, 'https://altro.it')).toBeNull();
});
it('senza Origin (un programma) niente intestazioni', () => {
  expect(corsHeaders(shard, undefined)).toBeNull();
});
```

`gateway/test/rate-limit.test.js`:

```js
import {it, expect} from 'vitest';
import {createRateLimiter} from '../src/rate-limit.js';

it('esaurisce la capacita e si ricarica col tempo', () => {
  let t = 0;
  const rl = createRateLimiter({capacity: 2, perSecond: 1, now: () => t});
  expect(rl.take('a')).toBe(true);
  expect(rl.take('a')).toBe(true);
  expect(rl.take('a')).toBe(false);
  expect(rl.take('b')).toBe(true);   // chiavi indipendenti
  t = 1000;
  expect(rl.take('a')).toBe(true);
});
```

`gateway/test/log.test.js`:

```js
import {it, expect, vi} from 'vitest';
import {logEvent} from '../src/log.js';

it('scrive solo i campi ammessi e toglie i numeri decimali dagli errori', () => {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  logEvent({route: '/v1/:shard/rejoin', status: 200, ms: 12, shard: 'webmapp', profile: 'mtb',
            body: {position: [10.123456, 44.654321]}, error: 'punto 44.654321,10.123456 non trovato'});
  const line = out.mock.calls.at(-1)[0];
  out.mockRestore();
  expect(line).toContain('"status":200');
  expect(line).not.toContain('44.654321');
  expect(line).not.toContain('10.123456');
  expect(line).not.toContain('body');
});
```

`gateway/test/app.test.js`:

```js
import {it, expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';

const config = {
  shards: {s: {profiles: {escursionista: 'escursionista'}, origins: ['https://ok.it'],
               limits: false, rate: {capacity: 1, perSecond: 0.001}}},
  profiles: {escursionista: {mode: 'foot', version: '3'}},
};
const app = () => createApp({config,
  dataStamp: () => ({osm: '2026-10-15T20:21:02Z', builtAt: '2026-10-16T03:00:00Z'})});

it('/v1/version espone la data dei dati, senza cache', async () => {
  const r = await request(app()).get('/v1/version');
  expect(r.body.osm).toBe('2026-10-15T20:21:02Z');
  expect(r.headers['cache-control']).toBe('no-cache');
});
it('/v1/:shard/profiles elenca i profili con la versione', async () => {
  const r = await request(app()).get('/v1/s/profiles').set('Origin', 'https://ok.it');
  expect(r.body).toEqual([{name: 'escursionista', mode: 'foot', version: '3'}]);
  expect(r.headers['access-control-allow-origin']).toBe('https://ok.it');
});
it('shard sconosciuto: 404', async () => {
  expect((await request(app()).get('/v1/nessuno/profiles')).status).toBe(404);
});
it('dietro il proxy il limite e\' per utente (X-Forwarded-For)', async () => {
  const a = app();
  expect((await request(a).get('/v1/s/profiles').set('X-Forwarded-For', '203.0.113.1')).status).toBe(200);
  expect((await request(a).get('/v1/s/profiles').set('X-Forwarded-For', '203.0.113.2')).status).toBe(200);
  expect((await request(a).get('/v1/s/profiles').set('X-Forwarded-For', '203.0.113.1')).status).toBe(429);
});
it('limite di richieste anche senza Origin, e senza intestazioni CORS', async () => {
  const a = app();
  expect((await request(a).get('/v1/s/profiles')).status).toBe(200);
  const r = await request(a).get('/v1/s/profiles');
  expect(r.status).toBe(429);
  expect(r.headers['access-control-allow-origin']).toBeUndefined();
});
```

Run: `cd gateway && npm install && npm test`
Expected: FAIL, moduli `../src/*.js` mancanti.

- [ ] **Step 3: Implementazione**

`gateway/src/config.js`:

```js
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export function loadConfig(dir) {
  const shards = JSON.parse(readFileSync(join(dir, 'shards.json'), 'utf8'));
  const profiles = JSON.parse(readFileSync(join(dir, 'profiles.json'), 'utf8'));
  for (const [id, s] of Object.entries(shards))
    for (const engine of Object.values(s.profiles))
      if (!profiles[engine]) throw new Error(`shard ${id}: profilo del motore sconosciuto: ${engine}`);
  return {shards, profiles};
}
```

`gateway/src/cors.js`:

```js
// Il CORS ferma l'uso da siti altrui nel browser, non chi chiama da un
// programma: per quello c'e' il limite di richieste (overview, "Servizio pubblico").
export function corsHeaders(shard, origin) {
  if (!origin || !shard.origins.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
```

`gateway/src/rate-limit.js`:

```js
export function createRateLimiter({capacity, perSecond, now = Date.now}) {
  const buckets = new Map();
  return {
    take(key) {
      const t = now();
      const b = buckets.get(key) ?? {tokens: capacity, at: t};
      b.tokens = Math.min(capacity, b.tokens + ((t - b.at) / 1000) * perSecond);
      b.at = t;
      const ok = b.tokens >= 1;
      if (ok) b.tokens -= 1;
      buckets.set(key, b);
      return ok;
    },
  };
}
```

`gateway/src/log.js`:

```js
// Unico punto da cui il gateway scrive un log: le posizioni sono dati personali
// (CLAUDE.md, "Nessuna coordinata nei log").
const ALLOWED = ['route', 'status', 'ms', 'shard', 'profile', 'stato', 'error'];

export function logEvent(fields) {
  const out = {t: new Date().toISOString()};
  for (const k of ALLOWED) if (fields[k] !== undefined) out[k] = fields[k];
  if (typeof out.error === 'string') out.error = out.error.replace(/-?\d+\.\d{3,}/g, '<n>');
  process.stdout.write(JSON.stringify(out) + '\n');
}
```

`gateway/src/app.js`:

```js
import express from 'express';
import {corsHeaders} from './cors.js';
import {createRateLimiter} from './rate-limit.js';
import {logEvent} from './log.js';

export function createApp({config, dataStamp, handlers = {}}) {
  const app = express();
  app.disable('x-powered-by');
  // dietro Caddy ogni richiesta arriva da 127.0.0.1: senza, tutti gli utenti
  // finirebbero nello stesso secchio del limite di richieste
  app.set('trust proxy', 'loopback');
  app.use(express.json({limit: '2mb'}));
  const limiters = Object.fromEntries(
    Object.entries(config.shards).map(([id, s]) => [id, createRateLimiter(s.rate)]));

  app.get('/v1/version', (_req, res) => {
    res.set('Cache-Control', 'no-cache').json(dataStamp());
  });

  app.use('/v1/:shard', (req, res, next) => {
    const t0 = Date.now();
    const shard = config.shards[req.params.shard];
    if (!shard) return res.status(404).json({stato: 'shard_sconosciuto'});
    const cors = corsHeaders(shard, req.get('Origin'));
    if (cors) res.set(cors);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!limiters[req.params.shard].take(`${req.params.shard}|${req.ip}`))
      return res.status(429).json({stato: 'troppe_richieste'});
    res.on('finish', () => logEvent({
      route: `/v1/:shard${req.path}`, status: res.statusCode, ms: Date.now() - t0,
      shard: req.params.shard, profile: typeof req.body?.profile === 'string' ? req.body.profile : undefined,
    }));
    req.shard = shard;
    next();
  });

  app.get('/v1/:shard/profiles', (req, res) => {
    res.json(Object.entries(req.shard.profiles).map(([name, engineName]) => ({
      name, mode: config.profiles[engineName].mode, version: config.profiles[engineName].version,
    })));
  });

  if (handlers.route) app.post('/v1/:shard/route', handlers.route);
  if (handlers.rejoin) app.post('/v1/:shard/rejoin', handlers.rejoin);
  return app;
}
```

`gateway/src/server.js` (avvio; i gestori si aggiungono nei Task 6 e 7):

```js
import {readFileSync} from 'node:fs';
import express from 'express';
import {loadConfig} from './config.js';
import {createApp} from './app.js';

const config = loadConfig(process.env.WM_CONFIG ?? new URL('../config', import.meta.url).pathname);
const dataStamp = () => JSON.parse(readFileSync(process.env.WM_STAMP ?? '/graph/stamp.json', 'utf8'));
const app = createApp({config, dataStamp});
app.use('/preview', express.static(process.env.WM_PREVIEW ?? new URL('../../preview', import.meta.url).pathname));
app.listen(Number(process.env.PORT ?? 8991), '0.0.0.0',
  () => console.log(`gateway in ascolto su ${process.env.PORT ?? 8991}`));
```

- [ ] **Step 4: Impronte dei profili**

Run:

```bash
cd gateway && node -e "
const {createHash}=require('crypto'),fs=require('fs');
const p=JSON.parse(fs.readFileSync('config/profiles.json'));
for(const [n,v] of Object.entries(p)){const h=createHash('sha256');
for(const f of v.files)h.update(fs.readFileSync('../engine/profiles/'+f));v.sha256=h.digest('hex');}
fs.writeFileSync('config/profiles.json',JSON.stringify(p,null,2)+'\n');"
```

- [ ] **Step 5: Test verdi**

Run: `cd gateway && npm test`
Expected: PASS (config, cors, rate-limit, log, app).

- [ ] **Step 6: Commit**

```bash
git add gateway/
git commit -m "feat(routing-escursionistico): gateway con shard, CORS per shard, limite di richieste e log senza coordinate"
```

### Task 6: Calcolo del tracciato (`POST /v1/:shard/route`)

**Files:**
- Create: `gateway/src/difficulty.js`, `time.js`, `engine.js`, `details.js`,
  `retry.js`, `route.js`
- Modify: `gateway/src/server.js`
- Test: `gateway/test/time.test.js`, `details.test.js`, `retry.test.js`,
  `route.test.js`

**Interfaces:**
- Consumes: `createApp` (Task 5); motore GraphHopper `POST /route`.
- Produces:
  - `createEngine(baseUrl, fetchImpl) -> {route(body), match(gpx, profile)}`,
    entrambe `-> Promise<{ok, status, json}>`;
  - `withRetry(fn, {timeoutMs, stepMs, sleep, now}) -> Promise`: ripete `fn` su
    errore di rete o `5xx` fino a `timeoutMs`;
  - `hikingTimeHours({distanceM, ascendM, descendM}) -> number`;
  - `ratingToCai(r, origin) -> 'T'|'E'|'EE'|'EEA'|'ghiacciaio'|'via ferrata'|null`;
  - `summarizeDetails(ghPath, waysDb) -> {segments, unknownShare}`, con
    `Segment = {from, to, difficulty, origin, sac, longChain, surface, network, slope, ford, dismount}`;
  - `HttpError(status, stato, extra?)`, `sendError(res, e)`,
    `makeRouteCore(deps) -> compute(shard, profiloPubblico, points, {limits})`,
    `makeRouteHandler(deps) -> handler`;
  - richiesta `{profile, points: [[lon,lat],...], alternatives?: boolean, limits?: {maxHikeRating?, maxSlope?, excludeUnknown?}}`;
  - risposta `200 {profile, profileVersion, data: {osm}, distanceM, ascendM, descendM, timeH, geometry, snapped, segments, unknownShare, warning, snowWarning, alternatives}`.

- [ ] **Step 1: Test di tempo, dettagli e ripetizione**

`gateway/test/time.test.js`:

```js
import {it, expect} from 'vitest';
import {hikingTimeHours} from '../src/time.js';

// DIN 33466: Th = km/4, Tv = salita/300 + discesa/500, T = max + min/2
it('piano: 8 km in 2 ore', () => {
  expect(hikingTimeHours({distanceM: 8000, ascendM: 0, descendM: 0})).toBeCloseTo(2, 5);
});
it('salita: 4 km e 600 m su: max(1, 2) + 1/2 = 2,5 ore', () => {
  expect(hikingTimeHours({distanceM: 4000, ascendM: 600, descendM: 0})).toBeCloseTo(2.5, 5);
});
it('la discesa conta', () => {
  expect(hikingTimeHours({distanceM: 4000, ascendM: 0, descendM: 1000})).toBeCloseTo(2.5, 5);
});
```

`gateway/test/details.test.js`:

```js
import {it, expect} from 'vitest';
import {summarizeDetails} from '../src/details.js';
import {ratingToCai} from '../src/difficulty.js';

const rows = {
  11: {cai: 'EE', sac: 'alpine_hiking', origin: 'cai', long_chain: 0},
  12: {cai: null, sac: null, origin: 'none', long_chain: 1},
};
const waysDb = {prepare: () => ({get: id => rows[id]})};

it('ratingToCai', () => {
  expect(ratingToCai(3)).toBe('EE');
  expect(ratingToCai(6, 'sac')).toBe('EEA');
  expect(ratingToCai(6, 'glacier')).toBe('ghiacciaio');
  expect(ratingToCai(6, 'via_ferrata')).toBe('via ferrata');
  expect(ratingToCai(0)).toBe(null);
});

it('unisce i dettagli del motore e la tabella laterale, senza esporre horse_rating', () => {
  const path = {
    points: {coordinates: [[10, 44], [10.001, 44], [10.002, 44], [10.003, 44]]},
    details: {
      osm_way_id: [[0, 2, 11], [2, 3, 12]],
      hike_rating: [[0, 2, 3], [2, 3, 0]],
      surface: [[0, 3, 'missing']],
      foot_network: [[0, 2, 'local'], [2, 3, 'missing']],
      average_slope: [[0, 3, 4]],
      road_environment: [[0, 2, 'road'], [2, 3, 'ford']],
      get_off_bike: [[0, 3, false]],
    },
  };
  const r = summarizeDetails(path, waysDb);
  expect(r.segments[1].ford).toBe(true);
  expect(r.segments[0].ford).toBe(false);
  expect(r.segments[0].dismount).toBe(false);
  expect(r.segments[0]).toMatchObject({from: 0, to: 2, difficulty: 'EE', origin: 'cai', sac: 'alpine_hiking', longChain: false});
  expect(r.segments[1]).toMatchObject({from: 2, to: 3, difficulty: null, origin: 'none', longChain: true});
  expect(JSON.stringify(r)).not.toContain('horse');
  expect(r.unknownShare).toBeCloseTo(1 / 3, 2);
});
```

`gateway/test/retry.test.js`:

```js
import {it, expect} from 'vitest';
import {withRetry} from '../src/retry.js';

const sleep = async () => {};
it('ripete finche il motore torna su', async () => {
  let n = 0;
  const r = await withRetry(async () => {
    if (++n < 3) throw new Error('ECONNREFUSED');
    return {ok: true, status: 200};
  }, {timeoutMs: 60000, stepMs: 1000, sleep});
  expect(r.ok).toBe(true);
  expect(n).toBe(3);
});
it('oltre il tempo massimo rilancia', async () => {
  let t = 0;
  const now = () => (t += 1000);
  await expect(withRetry(async () => { throw new Error('ECONNREFUSED'); },
    {timeoutMs: 5000, stepMs: 1000, sleep, now})).rejects.toThrow('ECONNREFUSED');
});
it('un 5xx conta come motore non pronto', async () => {
  let n = 0;
  const r = await withRetry(async () => (++n < 2 ? {ok: false, status: 503} : {ok: true, status: 200}),
    {timeoutMs: 60000, stepMs: 1000, sleep});
  expect(r.status).toBe(200);
});
```

Run: `cd gateway && npm test -- time details retry`
Expected: FAIL, moduli mancanti.

- [ ] **Step 2: Implementazione di tempo, difficolta', dettagli e ripetizione**

`gateway/src/time.js`:

```js
// Tempo a piedi secondo la DIN 33466: 4 km/h in piano, 300 m/h in salita,
// 500 m/h in discesa; il maggiore dei due tempi piu' meta' del minore. E' un
// massimo su totali, quindi non si esprime come velocita' per arco. I valori
// della norma sono da verificare sul testo (overview, "Tempo di percorrenza").
export function hikingTimeHours({distanceM, ascendM, descendM}) {
  const th = distanceM / 1000 / 4;
  const tv = ascendM / 300 + descendM / 500;
  return Math.max(th, tv) + Math.min(th, tv) / 2;
}
```

`gateway/src/difficulty.js`:

```js
// Stessa tabella di prepare/difficulty.py (piano, "Corrispondenza delle difficolta'").
// Il rating 6 e' EEA oltre il grado (sac_scale originale) oppure un ghiacciaio
// o una via ferrata: lo distingue l'origine della tabella laterale.
const CAI = {1: 'T', 2: 'E', 3: 'EE', 4: 'EEA', 5: 'EEA', 6: 'EEA'};
const BY_ORIGIN = {glacier: 'ghiacciaio', via_ferrata: 'via ferrata'};
export const ratingToCai = (r, origin) => BY_ORIGIN[origin] ?? CAI[r] ?? null;
```

`gateway/src/details.js`:

```js
import {ratingToCai} from './difficulty.js';

// I dettagli di GraphHopper sono intervalli [da, a, valore] sugli indici dei
// punti: si spezzano tutti agli stessi confini e si arricchiscono con la
// tabella laterale del pre-passo. horse_rating non si chiede e non si espone:
// e' il contenitore delle catene lunghe (CLAUDE.md).
function cuts(details) {
  const s = new Set();
  for (const list of Object.values(details)) for (const [a, b] of list) { s.add(a); s.add(b); }
  return [...s].sort((x, y) => x - y);
}
const valueAt = (list, i) => list?.find(([a, b]) => a <= i && i < b)?.[2];

function lengthM(coords, from, to) {
  let d = 0;
  for (let i = from; i < to; i++) {
    const [x1, y1] = coords[i], [x2, y2] = coords[i + 1];
    const k = Math.cos(((y1 + y2) / 2) * Math.PI / 180);
    d += Math.hypot((x2 - x1) * k, y2 - y1) * 111320;
  }
  return d;
}

export function summarizeDetails(path, waysDb) {
  const d = path.details ?? {};
  const coords = path.points.coordinates;
  const lookup = waysDb?.prepare('select cai, sac, origin, long_chain from ways where way_id = ?');
  const c = cuts(d);
  const segments = [];
  let unknownM = 0, totalM = 0;
  for (let k = 0; k + 1 < c.length; k++) {
    const [from, to] = [c[k], c[k + 1]];
    const way = lookup?.get(valueAt(d.osm_way_id, from)) ?? {};
    const rating = valueAt(d.hike_rating, from) ?? 0;
    const origin = way.origin ?? (rating ? 'sac' : 'none');
    const seg = {
      from, to, difficulty: ratingToCai(rating, origin), origin,
      sac: way.sac ?? null, longChain: way.long_chain === 1,
      surface: valueAt(d.surface, from) ?? null, network: valueAt(d.foot_network, from) ?? null,
      slope: valueAt(d.average_slope, from) ?? null,
      ford: valueAt(d.road_environment, from) === 'ford',
      dismount: valueAt(d.get_off_bike, from) === true,
    };
    const m = lengthM(coords, from, to);
    totalM += m;
    if (seg.origin === 'none') unknownM += m;
    segments.push(seg);
  }
  return {segments, unknownShare: totalM ? unknownM / totalM : 0};
}
```

`gateway/src/retry.js`:

```js
// Durante lo scambio notturno il motore riparte (20-40 s): invece di
// rispondere "riprova" si ripete la chiamata fino a 60 s (overview, "Scambio
// del grafo").
export async function withRetry(fn, {timeoutMs = 60000, stepMs = 2000,
  sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now} = {}) {
  const end = now() + timeoutMs;
  for (;;) {
    try {
      const r = await fn();
      if (r.status < 500 || now() >= end) return r;
    } catch (e) {
      if (now() >= end) throw e;
    }
    await sleep(stepMs);
  }
}
```

Run: `cd gateway && npm test -- time details retry`
Expected: PASS.

- [ ] **Step 3: Test del gestore**

`gateway/test/route.test.js`:

```js
import {it, expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {makeRouteHandler} from '../src/route.js';

const config = {
  shards: {
    s: {profiles: {escursionista: 'escursionista', esperto: 'esperto', prudente: 'prudente'},
        origins: [], limits: false, rate: {capacity: 100, perSecond: 100}},
    p: {profiles: {escursionista: 'escursionista'}, origins: [], limits: true,
        rate: {capacity: 100, perSecond: 100}},
  },
  profiles: {escursionista: {mode: 'foot', version: '2', next: 'esperto'},
             esperto: {mode: 'foot', version: '1', next: 'alpinista'},
             prudente: {mode: 'foot', version: '1', next: 'escursionista'}},
};
const ghPath = (over = {}) => ({distance: 1000, ascend: 100, descend: 0, time: 900000,
  points: {type: 'LineString', coordinates: [[10, 44, 500], [10.01, 44, 600]]},
  details: {osm_way_id: [[0, 1, 1]], hike_rating: [[0, 1, 2]]}, ...over});
const NO_WAIT = {timeoutMs: 0, stepMs: 0, sleep: async () => {}};
const make = (engineRoute, calls = [], month = 7) => {
  const engine = {route: async body => { calls.push(body); return engineRoute(body); }};
  const route = makeRouteHandler({config, engine, waysDb: null, dataStamp: () => ({osm: 'X'}),
    bbox: [6.65, 35.45, 18.55, 47.05], retry: NO_WAIT, month: () => month});
  return createApp({config, dataStamp: () => ({osm: 'X'}), handlers: {route}});
};
const body = {profile: 'escursionista', points: [[10, 44], [10.01, 44]]};
const ok = async () => ({ok: true, status: 200, json: {paths: [ghPath()]}});

it('risposta completa, con il tempo DIN e senza il time del motore', async () => {
  const r = await request(make(ok)).post('/v1/s/route').send(body);
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({profile: 'escursionista', profileVersion: '2', data: {osm: 'X'},
                                distanceM: 1000, ascendM: 100});
  expect(r.body.timeH).toBeCloseTo(0.4583, 3);   // max(0,25; 0,333) + 0,25/2
  expect(r.body.warning).toMatch(/percorribilita/);
  expect(r.body.snowWarning).toBe(false);
  expect(JSON.stringify(r.body)).not.toContain('900000');
});
it('avviso neve sopra 2000 m fra novembre e maggio', async () => {
  const high = async () => ({ok: true, status: 200, json: {paths: [ghPath({
    points: {type: 'LineString', coordinates: [[10, 44, 1900], [10.01, 44, 2150]]}})]}});
  expect((await request(make(high, [], 3)).post('/v1/s/route').send(body)).body.snowWarning).toBe(true);
  expect((await request(make(high, [], 7)).post('/v1/s/route').send(body)).body.snowWarning).toBe(false);
});
it('profilo non dello shard: 400', async () => {
  const r = await request(make(ok)).post('/v1/s/route').send({...body, profile: 'mtb'});
  expect(r.status).toBe(400);
  expect(r.body.stato).toBe('profilo_non_ammesso');
});
it('punti fuori area o invertiti (lat,lon): 400 prima del motore', async () => {
  const calls = [];
  const r = await request(make(ok, calls)).post('/v1/s/route')
    .send({...body, points: [[44, 10], [44.01, 10]]});
  expect(r.status).toBe(400);
  expect(r.body.stato).toBe('fuori_area');
  expect(calls).toHaveLength(0);
});
it('nessun collegamento: 404 con il profilo successivo suggerito', async () => {
  const r = await request(make(async () => ({ok: false, status: 400,
    json: {message: 'Connection between locations not found'}}))).post('/v1/s/route').send(body);
  expect(r.status).toBe(404);
  expect(r.body).toEqual({stato: 'nessun_percorso', suggerimento: 'esperto'});
});
it('motore spento oltre la coda: 503 riprova', async () => {
  const r = await request(make(async () => { throw new Error('ECONNREFUSED'); }))
    .post('/v1/s/route').send(body);
  expect(r.status).toBe(503);
  expect(r.body.stato).toBe('riprova');
});
it('i limiti per richiesta solo sugli shard che li ammettono', async () => {
  const calls = [];
  expect((await request(make(ok)).post('/v1/s/route').send({...body, limits: {maxHikeRating: 1}})).status).toBe(400);
  await request(make(ok, calls)).post('/v1/p/route').send({...body, limits: {maxHikeRating: 1, excludeUnknown: true}});
  expect(calls[0].custom_model.parameters.max_hike_rating).toBe(1);
  expect(calls[0].custom_model.priority).toEqual([{if: 'road_class == PATH && hike_rating == 0', multiply_by: '0'}]);
});
it('alternative: i profili accanto, solo se il tracciato cambia', async () => {
  const calls = [];
  const engine = async b => ({ok: true, status: 200, json: {paths: [
    ghPath({distance: b.profile === 'esperto' ? 700 : 1000})]}});
  const r = await request(make(engine, calls)).post('/v1/s/route').send({...body, alternatives: true});
  expect(calls.map(c => c.profile).sort()).toEqual(['escursionista', 'esperto', 'prudente']);
  expect(r.body.alternatives).toEqual([expect.objectContaining({profile: 'esperto', distanceM: 700})]);
});
```

Run: `cd gateway && npm test -- route`
Expected: FAIL, `../src/route.js` mancante.

- [ ] **Step 4: Motore e gestore**

`gateway/src/engine.js`:

```js
export function createEngine(baseUrl, fetchImpl = fetch) {
  async function call(path, init) {
    const res = await fetchImpl(baseUrl + path, init);   // un errore di rete sale al chiamante
    return {ok: res.ok, status: res.status, json: await res.json().catch(() => ({}))};
  }
  return {
    route: body => call('/route', {method: 'POST', headers: {'Content-Type': 'application/json'},
                                    body: JSON.stringify(body)}),
    match: (gpx, profile) => call(`/match?profile=${encodeURIComponent(profile)}&points_encoded=false`,
                                  {method: 'POST', headers: {'Content-Type': 'application/gpx+xml'}, body: gpx}),
  };
}
```

`gateway/src/route.js`:

```js
import {hikingTimeHours} from './time.js';
import {summarizeDetails} from './details.js';
import {withRetry} from './retry.js';

const DETAILS = ['osm_way_id', 'hike_rating', 'surface', 'foot_network', 'average_slope', 'road_class',
                 'road_environment', 'get_off_bike'];
export const WARNING = 'Il servizio non garantisce la percorribilita\' dei sentieri: ' +
  'verifica sul posto condizioni e segnaletica.';
const SNOW_M = 2000, SNOW_MONTHS = new Set([11, 12, 1, 2, 3, 4, 5]);
// Ordine dei profili a piedi: le alternative sono i profili accanto.
const LADDER = ['prudente', 'escursionista', 'esperto', 'alpinista'];

export class HttpError extends Error {
  constructor(status, stato, extra = {}) { super(stato); this.status = status; this.stato = stato; this.extra = extra; }
}

export function sendError(res, e) {
  if (e instanceof HttpError) return res.status(e.status).json({stato: e.stato, ...e.extra});
  res.status(500).json({stato: 'errore'});
}

export function validPoints(points, bbox) {
  if (!Array.isArray(points) || points.length < 2) return false;
  const [w, s, e, n] = bbox;
  return points.every(p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite)
    && p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n);
}

export function customModelFor(limits) {
  if (!limits) return undefined;
  const cm = {parameters: {}, priority: []};
  if (limits.maxHikeRating !== undefined) cm.parameters.max_hike_rating = limits.maxHikeRating;
  if (limits.maxSlope !== undefined) cm.parameters.max_slope = limits.maxSlope;
  if (limits.excludeUnknown) cm.priority.push({if: 'road_class == PATH && hike_rating == 0', multiply_by: '0'});
  return cm;
}

export function makeRouteCore({config, engine, waysDb, dataStamp, retry = {}, month = () => new Date().getMonth() + 1}) {
  return async function compute(shard, publicProfile, points, {limits} = {}) {
    const engineProfile = shard.profiles[publicProfile];
    if (!engineProfile) throw new HttpError(400, 'profilo_non_ammesso');
    const req = {profile: engineProfile, points, points_encoded: false, elevation: true,
                 instructions: false, details: DETAILS};
    const cm = customModelFor(limits);
    if (cm) req.custom_model = cm;
    let r;
    try { r = await withRetry(() => engine.route(req), retry); }
    catch { throw new HttpError(503, 'riprova'); }
    if (r.status >= 500) throw new HttpError(503, 'riprova');
    if (!r.ok) {
      if (/not found|Cannot find point/i.test(r.json?.message ?? '')) {
        const next = config.profiles[engineProfile].next;
        const suggestion = Object.keys(shard.profiles).find(p => shard.profiles[p] === next);
        throw new HttpError(404, 'nessun_percorso', suggestion ? {suggerimento: suggestion} : {});
      }
      throw new HttpError(400, 'richiesta_non_valida');
    }
    const p = r.json.paths[0];
    const mode = config.profiles[engineProfile].mode;
    const {segments, unknownShare} = summarizeDetails(p, waysDb);
    const maxEle = Math.max(...p.points.coordinates.map(c => c[2] ?? 0));
    return {
      profile: publicProfile, profileVersion: config.profiles[engineProfile].version,
      data: {osm: dataStamp().osm}, distanceM: p.distance, ascendM: p.ascend, descendM: p.descend,
      // a piedi DIN 33466 sui totali; il time del motore non si espone (overview)
      timeH: mode === 'foot'
        ? hikingTimeHours({distanceM: p.distance, ascendM: p.ascend ?? 0, descendM: p.descend ?? 0})
        : p.time / 3600000,
      geometry: p.points, snapped: p.snapped_waypoints, segments, unknownShare,
      warning: WARNING, snowWarning: maxEle > SNOW_M && SNOW_MONTHS.has(month()),
    };
  };
}

export function makeRouteHandler(deps) {
  const compute = makeRouteCore(deps);
  return async (req, res) => {
    const {profile, points, limits, alternatives} = req.body ?? {};
    try {
      if (limits && !req.shard.limits) throw new HttpError(400, 'limiti_non_ammessi');
      if (!validPoints(points, deps.bbox)) throw new HttpError(400, 'fuori_area');
      const main = await compute(req.shard, profile, points, {limits});
      main.alternatives = [];
      if (alternatives) {
        const i = LADDER.indexOf(profile);
        const near = [LADDER[i - 1], LADDER[i + 1]].filter(n => n && req.shard.profiles[n]);
        // un profilo accanto e' un altro profilo del server, non un custom model
        // per richiesta: con LM e' ammesso anche se meno severo
        const alts = await Promise.allSettled(near.map(n => compute(req.shard, n, points)));
        for (const a of alts)
          if (a.status === 'fulfilled' && Math.abs(a.value.distanceM - main.distanceM) / main.distanceM > 0.05)
            main.alternatives.push(a.value);
      }
      res.json(main);
    } catch (e) { sendError(res, e); }
  };
}
```

In `gateway/src/server.js` aggiungere:

```js
import Database from 'better-sqlite3';
import {createEngine} from './engine.js';
import {makeRouteHandler} from './route.js';
// il rettangolo sta solo in tools/bbox.sh: il compose lo passa, qui non c'e' un default
if (!process.env.WM_GRAPH_BBOX) throw new Error('serve WM_GRAPH_BBOX (tools/bbox.sh)');
const BBOX = process.env.WM_GRAPH_BBOX.split(',').map(Number);
const waysDb = new Database(process.env.WM_WAYS_DB ?? '/graph/ways.sqlite', {readonly: true});
const engine = createEngine(process.env.WM_ENGINE_URL ?? 'http://engine:8989');
const deps = {config, engine, waysDb, dataStamp, bbox: BBOX};
const route = makeRouteHandler(deps);
// e createApp({config, dataStamp, handlers: {route}})
```

Run: `cd gateway && npm test`
Expected: PASS.

- [ ] **Step 5: Prova contro il motore dell'area di prova**

Con `wm-engine-area` acceso (Task 4). Il gateway usa il rettangolo dell'area
di prova per rifiutare i punti fuori:

```bash
printf '{"osm":"prova","builtAt":"%s"}\n' "$(date -u +%FT%TZ)" > data/graph/stamp.json
cd gateway && WM_ENGINE_URL=http://127.0.0.1:18989 WM_WAYS_DB=../data/ways.sqlite \
  WM_STAMP=../data/graph/stamp.json WM_GRAPH_BBOX=10.0,43.9,10.9,44.5 PORT=8991 npm start &
curl -s localhost:8991/v1/preview/route -H 'Content-Type: application/json' \
  -d '{"profile":"escursionista","points":[[10.2335,44.0490],[10.2617,44.0253]],"alternatives":true}' \
  | jq '{distanceM, ascendM, timeH, unknownShare, n: (.segments|length), alt: [.alternatives[].profile]}'
```

Expected: distanza, salita, tempo e segmenti. Annotare in `notes.md` il tempo
della richiesta con le alternative (tre calcoli, senza LM sulla cella).

- [ ] **Step 6: Commit**

```bash
git add gateway/
git commit -m "feat(routing-escursionistico): calcolo del tracciato con dettagli, tempo DIN 33466, avvisi e alternative"
```

### Task 7: Rientro sulla traccia (`POST /v1/:shard/rejoin`)

**Files:**
- Create: `gateway/src/rejoin/geometry.js`, `gateway/src/rejoin/rejoin.js`
- Modify: `gateway/src/server.js`
- Test: `gateway/test/geometry.test.js`, `gateway/test/rejoin.test.js`

**Interfaces:**
- Consumes: `makeRouteCore`, `HttpError`, `sendError` (Task 6); `engine.match`.
- Produces:
  - `haversineM(a, b)`, `trackLengthM(track)`,
    `project(track, point, minAlongM, maxAlongM) -> {alongM, distanceM, point}`,
    `pointAtM(track, alongM)`, `candidates(track, fromM, offsetsM, direction) -> [{alongM, point}]`,
    `meanDistanceM(a, b)`, `maxDistanceM(a, b)`;
  - `makeRejoinHandler({config, engine, compute, bands, offsetsM, matchLimits}) -> handler`;
  - richiesta `{profile, position: [lon,lat], track: [[lon,lat],...], progressM, direction?: 'forward'|'backward'|'nearest', matchTrack?: boolean}`;
  - risposte: `200 {stato: 'su_traccia'}`, `200 {stato: 'troppo_lontano'}`,
    `200 {stato: 'rientro', joinAtM, offPathM, route, backToReached?}`,
    `400 {stato: 'traccia_non_valida'}`, `422 {stato: 'traccia_non_su_osm'}`.

- [ ] **Step 1: Test della geometria**

`gateway/test/geometry.test.js`:

```js
import {it, expect} from 'vitest';
import {haversineM, trackLengthM, project, pointAtM, candidates, meanDistanceM} from '../src/rejoin/geometry.js';

const A = [10, 44], B = [10.01, 44];
const outAndBack = [A, B, A];

it('lunghezza', () => {
  expect(trackLengthM([A, B])).toBeCloseTo(haversineM(A, B), 3);
  expect(haversineM(A, B)).toBeGreaterThan(790);
  expect(haversineM(A, B)).toBeLessThan(810);
});
it('andata e ritorno: la proiezione segue il punto raggiunto', () => {
  const p = [10.005, 44.001];
  const L = haversineM(A, B);
  expect(project(outAndBack, p, 0).alongM).toBeCloseTo(L / 2, -1);
  expect(project(outAndBack, p, L).alongM).toBeCloseTo(L * 1.5, -1);
  expect(project(outAndBack, p, 0).distanceM).toBeCloseTo(111, -1);
});
it('un progresso oltre la fine si limita alla fine', () => {
  const L = trackLengthM(outAndBack);
  expect(project(outAndBack, [10, 44.001], L * 3).alongM).toBeCloseTo(L, 3);
});
it('candidati in avanti e indietro, entro la traccia', () => {
  const L = haversineM(A, B);
  expect(candidates([A, B], 100, [0, 500, 1000], 'forward').map(c => Math.round(c.alongM)))
    .toEqual([100, 600, Math.round(L)]);
  expect(candidates([A, B], 700, [0, 500, 1000], 'backward').map(c => Math.round(c.alongM)))
    .toEqual([700, 200, 0]);
  expect(pointAtM([A, B], 0)).toEqual(A);
});
it('distanza media fra due linee', () => {
  expect(meanDistanceM([A, B], [[10, 44.001], [10.01, 44.001]])).toBeCloseTo(111, -1);
});
```

Run: `cd gateway && npm test -- geometry`
Expected: FAIL, modulo mancante.

- [ ] **Step 2: Geometria**

`gateway/src/rejoin/geometry.js`:

```js
const R = 6371008.8;
const rad = d => d * Math.PI / 180;

export function haversineM([x1, y1], [x2, y2]) {
  const dy = rad(y2 - y1), dx = rad(x2 - x1);
  const a = Math.sin(dy / 2) ** 2 + Math.cos(rad(y1)) * Math.cos(rad(y2)) * Math.sin(dx / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function trackLengthM(track) {
  let d = 0;
  for (let i = 1; i < track.length; i++) d += haversineM(track[i - 1], track[i]);
  return d;
}

// Proiezione su un segmento in coordinate locali (equirettangolari): basta per
// segmenti di traccia, lunghi metri o decine di metri.
function projectOnSegment(a, b, p) {
  const k = Math.cos(rad(p[1]));
  const ax = a[0] * k, bx = b[0] * k, px = p[0] * k;
  const dx = bx - ax, dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  return len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
}

export function pointAtM(track, alongM) {
  let along = 0;
  for (let i = 1; i < track.length; i++) {
    const seg = haversineM(track[i - 1], track[i]);
    if (along + seg >= alongM) {
      const t = seg ? (alongM - along) / seg : 0;
      const [a, b] = [track[i - 1], track[i]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    along += seg;
  }
  return track.at(-1);
}

// Il punto della traccia piu' vicino a `point`, cercato fra minAlongM e
// maxAlongM: e' cosi' che il punto gia' raggiunto toglie l'ambiguita' delle
// andate e ritorno. Gli estremi si limitano alla traccia.
export function project(track, point, minAlongM = 0, maxAlongM = Infinity) {
  const total = trackLengthM(track);
  const lo = Math.min(Math.max(0, minAlongM), total);
  const hi = Math.min(Math.max(lo, maxAlongM), total);
  const at = m => {
    const q = pointAtM(track, m);
    return {alongM: m, point: q, distanceM: haversineM(point, q)};
  };
  let best = at(hi);
  let along = 0;
  for (let i = 1; i < track.length; i++) {
    const seg = haversineM(track[i - 1], track[i]);
    if (along + seg >= lo && along <= hi) {
      const t = projectOnSegment(track[i - 1], track[i], point);
      const c = at(Math.min(hi, Math.max(lo, along + t * seg)));
      if (c.distanceM < best.distanceM) best = c;
    }
    along += seg;
  }
  return best;
}

export function candidates(track, fromM, offsetsM, direction) {
  const total = trackLengthM(track);
  const sign = direction === 'backward' ? -1 : 1;
  const seen = new Set(), out = [];
  for (const off of offsetsM) {
    const m = Math.min(total, Math.max(0, fromM + sign * off));
    if (seen.has(Math.round(m))) continue;
    seen.add(Math.round(m));
    out.push({alongM: m, point: pointAtM(track, m)});
  }
  return out;
}

// Distanza media e massima dei punti di `b` (uno ogni 20 m) dalla linea `a`.
function samples(line, stepM = 20) {
  const L = trackLengthM(line), out = [];
  for (let m = 0; m <= L; m += stepM) out.push(pointAtM(line, m));
  return out;
}
export const meanDistanceM = (a, b) => {
  const s = samples(b);
  return s.reduce((acc, p) => acc + project(a, p).distanceM, 0) / s.length;
};
export const maxDistanceM = (a, b) => Math.max(...samples(b).map(p => project(a, p).distanceM));
```

Run: `cd gateway && npm test -- geometry`
Expected: PASS.

- [ ] **Step 3: Test del rientro**

`gateway/test/rejoin.test.js`:

```js
import {it, expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {makeRejoinHandler} from '../src/rejoin/rejoin.js';

const config = {
  shards: {s: {profiles: {escursionista: 'escursionista', mtb: 'mtb'}, origins: [], limits: false,
               rate: {capacity: 100, perSecond: 100}}},
  profiles: {escursionista: {mode: 'foot', version: '1'}, mtb: {mode: 'mtb', version: '1'}},
};
const track = [[10, 44], [10.03, 44]];          // circa 2,4 km verso est
// finto calcolo: il rientro costa la linea d'aria; il motore aggancia 100 m piu' a sud
const compute = async (_shard, profile, points) => {
  const [a, b] = points;
  const d = Math.hypot((b[0] - a[0]) * 80000, (b[1] - a[1]) * 111000);
  return {profile, distanceM: d, timeH: d / 4000,
          geometry: {type: 'LineString', coordinates: points},
          snapped: {type: 'MultiPoint', coordinates: [[a[0], a[1] - 0.0009], b]}};
};
const handler = (match = async () => ({ok: false})) => makeRejoinHandler({config, engine: {match}, compute,
  bands: {minM: 50, maxM: {foot: 1000, mtb: 2000}}, offsetsM: [0, 500, 1000],
  matchLimits: {meanM: 30, maxM: 100}});
const post = (b, match) => request(createApp({config, dataStamp: () => ({}), handlers: {rejoin: handler(match)}}))
  .post('/v1/s/rejoin').send({profile: 'escursionista', track, ...b});

it('sotto 50 m: su_traccia, nessun calcolo', async () => {
  expect((await post({position: [10.01, 44.0002], progressM: 500})).body.stato).toBe('su_traccia');
});
it("oltre 1 km a piedi: troppo_lontano; in mtb lo stesso punto e' dentro i 2 km", async () => {
  const pos = [10.01, 44.012];
  expect((await post({position: pos, progressM: 0})).body.stato).toBe('troppo_lontano');
  expect((await post({profile: 'mtb', position: pos, progressM: 0})).body.stato).toBe('rientro');
});
it('in avanti: il punto di rientro sta davanti al punto raggiunto', async () => {
  const r = await post({position: [10.005, 44.002], progressM: 1200});
  expect(r.body.stato).toBe('rientro');
  expect(r.body.joinAtM).toBeGreaterThanOrEqual(1200);
});
it('traccia dritta senza ostacoli: si rientra nel punto piu\' vicino, non in quello lontano', async () => {
  const r = await post({position: [10.005, 44.002], progressM: 0});
  const proj = 0.005 * 80000;                 // circa 400 m lungo la traccia
  expect(Math.abs(r.body.joinAtM - proj)).toBeLessThan(50);
});
it('indietro: il punto di rientro sta dietro', async () => {
  const r = await post({position: [10.02, 44.002], progressM: 1200, direction: 'backward'});
  expect(r.body.joinAtM).toBeLessThanOrEqual(1200);
});
it('tratto fuori sentiero dal punto agganciato', async () => {
  expect((await post({position: [10.005, 44.002], progressM: 0})).body.offPathM).toBeGreaterThan(90);
});
it('traccia degenere: 400', async () => {
  for (const t of [[[10, 44]], [[10, 44], [10, 44]]]) {
    const r = await post({track: t, position: [10, 44.002], progressM: 0});
    expect(r.status).toBe(400);
    expect(r.body.stato).toBe('traccia_non_valida');
  }
});
it('map matching troppo lontano dalla traccia: 422', async () => {
  const far = async () => ({ok: true, json: {paths: [{points: {coordinates: [[10, 44.01], [10.03, 44.01]]}}]}});
  const r = await post({position: [10.005, 44.002], progressM: 0, matchTrack: true}, far);
  expect(r.status).toBe(422);
  expect(r.body.stato).toBe('traccia_non_su_osm');
});
```

Il ritorno al punto raggiunto si verifica nello Step 5 sull'area di prova: con
il finto motore in linea d'aria il rientro piu' vicino e' sempre anche il piu'
corto, quindi la regola "meno di un terzo" non si puo' provare qui senza
falsare il finto motore.

Run: `cd gateway && npm test -- rejoin`
Expected: FAIL, modulo mancante.

- [ ] **Step 4: Rientro**

`gateway/src/rejoin/rejoin.js`:

```js
import {HttpError, sendError} from '../route.js';
import {candidates, haversineM, maxDistanceM, meanDistanceM, project, trackLengthM} from './geometry.js';

function toGpx(track) {
  const pts = track.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"></trkpt>`).join('');
  return `<?xml version="1.0"?><gpx version="1.1" creator="wm-routing"><trk><trkseg>${pts}</trkseg></trk></gpx>`;
}

// Il rientro: dentro la fascia di distanza, tre candidati nel verso chiesto,
// un calcolo per ciascuno in parallelo. Punteggio: tempo di rientro piu' due
// volte il tempo del tratto di traccia saltato. Con il resto del giro al posto
// del tratto saltato vincerebbe sempre il candidato piu' lontano (la linea
// d'aria verso di lui e' sempre piu' corta del giro), mentre deve vincere solo
// se evita un ostacolo (overview, "Rientro sulla traccia"). Il server non
// tiene stato: isteresi e attesa le fa l'app.
const SKIP_WEIGHT = 2;
export function makeRejoinHandler({config, engine, compute, bands, offsetsM, matchLimits}) {
  return async (req, res) => {
    const {profile, position, track: raw, progressM = 0, direction = 'forward', matchTrack = false} = req.body ?? {};
    try {
      if (!Array.isArray(raw) || raw.length < 2 || trackLengthM(raw) < 1) throw new HttpError(400, 'traccia_non_valida');
      if (!['forward', 'backward', 'nearest'].includes(direction)) throw new HttpError(400, 'verso_non_valido');
      const engineProfile = req.shard.profiles[profile];
      if (!engineProfile) throw new HttpError(400, 'profilo_non_ammesso');
      const mode = config.profiles[engineProfile].mode;
      let track = raw;
      if (matchTrack) {
        const m = await engine.match(toGpx(raw), engineProfile).catch(() => ({ok: false}));
        const coords = m.ok ? m.json?.paths?.[0]?.points?.coordinates : null;
        if (coords?.length > 1) {
          const matched = coords.map(([x, y]) => [x, y]);
          if (meanDistanceM(raw, matched) > matchLimits.meanM || maxDistanceM(raw, matched) > matchLimits.maxM)
            throw new HttpError(422, 'traccia_non_su_osm');
          track = matched;
        }
      }
      const total = trackLengthM(track);
      const reached = Math.min(Math.max(0, progressM), total);
      const here = direction === 'forward' ? project(track, position, reached)
                 : direction === 'backward' ? project(track, position, 0, reached)
                 : project(track, position);
      if (here.distanceM < bands.minM) return res.json({stato: 'su_traccia'});
      if (here.distanceM > bands.maxM[mode]) return res.json({stato: 'troppo_lontano'});

      const dir = direction === 'nearest' ? (here.alongM >= reached ? 'forward' : 'backward') : direction;
      const cands = candidates(track, here.alongM, offsetsM, dir);
      const speedMps = mode === 'foot' ? 4000 / 3600 : 12000 / 3600;
      const results = await Promise.allSettled(cands.map(c => compute(req.shard, profile, [position, c.point])));
      let best = null;
      results.forEach((r, i) => {
        if (r.status !== 'fulfilled') return;
        const skippedS = Math.abs(cands[i].alongM - here.alongM) / speedMps;
        const score = r.value.timeH * 3600 + SKIP_WEIGHT * skippedS;
        if (!best || score < best.score) best = {score, cand: cands[i], route: r.value};
      });
      if (!best) {
        if (results.some(r => r.reason?.status === 503)) throw new HttpError(503, 'riprova');
        throw new HttpError(404, 'nessun_percorso');
      }
      const out = {stato: 'rientro', joinAtM: best.cand.alongM, route: best.route};
      const snappedStart = best.route.snapped?.coordinates?.[0];
      const off = snappedStart ? haversineM(position, snappedStart) : 0;
      out.offPathM = off > 20 ? off : 0;
      // ritorno al punto gia' raggiunto, se costa meno di un terzo del rientro scelto
      if (dir === 'forward' && best.cand.alongM - reached > 1) {
        const back = await compute(req.shard, profile, [position, project(track, position, reached, reached).point])
          .catch(() => null);
        if (back && back.distanceM < best.route.distanceM / 3) out.backToReached = back;
      }
      res.json(out);
    } catch (e) { sendError(res, e); }
  };
}
```

In `gateway/src/server.js`:

```js
import {makeRouteCore} from './route.js';
import {makeRejoinHandler} from './rejoin/rejoin.js';
const compute = makeRouteCore(deps);
const rejoin = makeRejoinHandler({config, engine, compute,
  bands: {minM: 50, maxM: {foot: 1000, mtb: 2000}}, offsetsM: [0, 500, 1000],
  matchLimits: {meanM: 30, maxM: 100}});
// e createApp({config, dataStamp, handlers: {route, rejoin}})
```

Run: `cd gateway && npm test`
Expected: PASS.

- [ ] **Step 5: Prova sull'area di prova**

Con motore e gateway accesi (Task 6, Step 5):

```bash
R=$(curl -s localhost:8991/v1/preview/route -H 'Content-Type: application/json' \
  -d '{"profile":"escursionista","points":[[10.2335,44.0490],[10.2617,44.0253]]}')
T=$(echo "$R" | jq -c '[.geometry.coordinates[] | [.[0], .[1]]]')
M=$(echo "$R" | jq '.distanceM / 2')
P=$(echo "$R" | jq -c '.geometry.coordinates[(.geometry.coordinates|length/2|floor)] | [.[0] + 0.0025, .[1]]')
curl -s localhost:8991/v1/preview/rejoin -H 'Content-Type: application/json' \
  -d "{\"profile\":\"escursionista\",\"position\":$P,\"track\":$T,\"progressM\":$M,\"matchTrack\":true}" \
  | jq '{stato, joinAtM, offPathM, d: .route.distanceM, ritorno: (.backToReached != null)}'
```

Expected: `stato: "rientro"`, `joinAtM` maggiore o uguale a `M`. Poi, nella
preview (Task 8), cercare un caso in cui il punto raggiunto e' vicino e il
rientro in avanti passa dietro un crinale: la risposta deve contenere
`backToReached`. Annotare in `notes.md` il caso e il tempo della richiesta
(map matching piu' tre o quattro calcoli, senza LM sulla cella).

- [ ] **Step 6: Commit**

```bash
git add gateway/
git commit -m "feat(routing-escursionistico): rientro sulla traccia con tre candidati, verso e map matching"
```

### Task 8: Preview OpenLayers

> ⚠️ L'implementazione ha deviato da questo task: [notes.md](notes.md#task-8-preview)

**Files:**
- Create: `preview/index.html`, `preview/preview.js`, `tools/preview-check.mjs`

**Interfaces:**
- Consumes: `GET /v1/version`, `GET /v1/preview/profiles`,
  `POST /v1/preview/route`, `POST /v1/preview/rejoin`;
  `https://tiles.maphub.it/style.json`; `https://graphhopper.webmapp.it/route`.
- Produces: pagina `/preview/` con parametri URL
  `?p=lon,lat;lon,lat&motore=nuovo|produzione|entrambi&profilo=...&prod=hike&colore=difficolta|fondo|segnato|pendenza&verso=forward&percorsi=0&c=lon,lat&z=13`;
  `window.__wm = {map, state}` per gli strumenti.

- [ ] **Step 1: Controllo della pagina (che fallisce)**

`tools/preview-check.mjs`:

```js
// La preview si carica, crea la mappa OpenLayers, mostra la data dei dati e
// non mostra errori. Uso (dalla cartella gateway, dove e' installato
// playwright): node ../tools/preview-check.mjs [url]
import {chromium} from 'playwright';
const url = process.argv[2] ?? 'http://localhost:8991/preview/?c=10.25,44.04&z=13';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.__wm?.map && document.querySelector('#newProfile option'),
  null, {timeout: 20000});
const err = await page.textContent('#err');
const stamp = await page.textContent('#stamp');
await browser.close();
if (errors.length || err?.trim() || !stamp?.trim()) { console.error('!! errori:', errors, err, stamp); process.exit(1); }
console.log('ok: preview caricata');
```

Run: `cd gateway && npx playwright install chromium && node ../tools/preview-check.mjs`
Expected: FAIL (timeout: `/preview/` risponde 404).

- [ ] **Step 2: Pagina**

`preview/index.html`:

```html
<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Routing a confronto</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@7.3.0/ol.css">
  <script src="https://cdn.jsdelivr.net/npm/ol@7.3.0/dist/ol.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/ol-mapbox-style@11.0.0/dist/olms.js"></script>
  <style>
    html, body { margin: 0; height: 100%; font: 14px system-ui, sans-serif; background: #fff; }
    #map { position: absolute; inset: 0 320px 0 0; }
    #panel { position: absolute; top: 0; right: 0; bottom: 0; width: 320px; overflow: auto;
             padding: 12px; box-sizing: border-box; border-left: 1px solid #ccc; background: #fff; }
    #panel label { display: block; margin: 6px 0; }
    #profile { width: 100%; height: 120px; }
    #err { color: #b00; white-space: pre-wrap; }
    #stamp { color: #555; font-size: 12px; }
    .stats td { padding: 2px 6px; }
    @media (max-width: 700px) { #map { inset: 0 0 45% 0; } #panel { top: 55%; width: 100%; } }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="panel">
    <div id="stamp"></div>
    <label>Motore
      <select id="engine"><option value="nuovo">nuovo</option><option value="produzione">produzione</option>
        <option value="entrambi">entrambi</option></select></label>
    <label>Profilo nuovo <select id="newProfile"></select></label>
    <label>Profilo produzione <select id="prodProfile"><option>hike</option><option>foot</option><option>bike</option></select></label>
    <fieldset><legend>Limiti di prova (solo motore nuovo)</legend>
      <label>Difficolta' massima <select id="maxRating"><option value="">del profilo</option>
        <option value="1">T</option><option value="2">E</option><option value="3">EE</option><option value="4">EEA</option></select></label>
      <label>Pendenza massima % <input id="maxSlope" type="number" min="0" max="100" placeholder="del profilo"></label>
      <label><input id="excludeUnknown" type="checkbox"> escludi difficolta' sconosciuta</label>
    </fieldset>
    <label>Colora per <select id="colorBy"><option value="difficolta">difficolta'</option>
      <option value="fondo">fondo</option><option value="segnato">segnato</option><option value="pendenza">pendenza</option></select></label>
    <label><input id="rejoinMode" type="checkbox"> simula rientro (clic = posizione fuori traccia)</label>
    <label>Verso del rientro <select id="direction"><option value="forward">avanti</option>
      <option value="backward">indietro</option><option value="nearest">piu' vicino</option></select></label>
    <label>Metri gia' percorsi <input id="progress" type="number" min="0" value="0"></label>
    <button id="clear">Cancella punti</button>
    <table class="stats" id="stats"></table>
    <canvas id="profile"></canvas>
    <p id="warning"></p>
    <div id="err"></div>
  </div>
  <script src="preview.js"></script>
</body>
</html>
```

`preview/preview.js`:

```js
// Preview del routing: tile vettoriali di wm-tiles come sfondo, due motori a
// confronto sugli stessi punti. Lo stato sta nell'URL per condividere un caso.
const SHARD = 'preview';
const PROD = 'https://graphhopper.webmapp.it/route';
const COLORS = {nuovo: '#d0021b', produzione: '#1f6feb'};
const DIFF_COLORS = {T: '#2e7d32', E: '#f9a825', EE: '#e65100', EEA: '#6a1b9a', ghiacciaio: '#00838f'};
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);

function showError(e) { $('err').textContent = e ? String(e?.message ?? e) : ''; }

const state = {
  points: (q.get('p') ?? '').split(';').filter(Boolean).map(s => s.split(',').map(Number)),
  results: {},
};

const routeSource = new ol.source.Vector();
const routeLayer = new ol.layer.Vector({source: routeSource, zIndex: 10, style: f => f.get('style')});
const map = new ol.Map({
  target: 'map',
  view: new ol.View({
    center: ol.proj.fromLonLat((q.get('c') ?? '10.25,44.04').split(',').map(Number)),
    zoom: Number(q.get('z') ?? 13),
  }),
});
olms.apply(map, 'https://tiles.maphub.it/style.json').then(() => map.addLayer(routeLayer)).catch(showError);
window.__wm = {map, state};

for (const [id, key] of [['engine', 'motore'], ['prodProfile', 'prod'], ['colorBy', 'colore'],
                         ['direction', 'verso'], ['progress', 'percorsi']])
  if (q.get(key)) $(id).value = q.get(key);

function syncUrl() {
  const v = map.getView();
  const c = ol.proj.toLonLat(v.getCenter()).map(n => n.toFixed(5)).join(',');
  history.replaceState(null, '', '?' + new URLSearchParams({
    p: state.points.map(x => x.map(n => n.toFixed(5)).join(',')).join(';'),
    motore: $('engine').value, profilo: $('newProfile').value, prod: $('prodProfile').value,
    colore: $('colorBy').value, verso: $('direction').value, percorsi: $('progress').value,
    c, z: v.getZoom().toFixed(1),
  }));
}

async function loadMeta() {
  const [list, stamp] = await Promise.all([
    fetch(`/v1/${SHARD}/profiles`).then(r => r.json()),
    fetch('/v1/version').then(r => r.json()),
  ]);
  $('newProfile').innerHTML = list.map(p => `<option value="${p.name}">${p.name} (v${p.version})</option>`).join('');
  $('newProfile').value = q.get('profilo') ?? 'escursionista';
  $('stamp').textContent = `dati del grafo: ${stamp.osm}`;
}

function limits() {
  const l = {};
  if ($('maxRating').value) l.maxHikeRating = Number($('maxRating').value);
  if ($('maxSlope').value) l.maxSlope = Number($('maxSlope').value);
  if ($('excludeUnknown').checked) l.excludeUnknown = true;
  return Object.keys(l).length ? l : undefined;
}

async function routeNew() {
  const r = await fetch(`/v1/${SHARD}/route`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: $('newProfile').value, points: state.points, limits: limits(), alternatives: true})});
  const j = await r.json();
  if (!r.ok) throw new Error(`nuovo: ${j.stato}${j.suggerimento ? ` (prova ${j.suggerimento})` : ''}`);
  return j;
}

async function routeProd() {
  const r = await fetch(PROD, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: $('prodProfile').value, points: state.points, points_encoded: false,
                          elevation: true, instructions: false, details: ['foot_network']})});
  const j = await r.json();
  if (!r.ok) throw new Error(`produzione: ${j.message}`);
  const p = j.paths[0];
  return {distanceM: p.distance, ascendM: p.ascend, descendM: p.descend, timeH: p.time / 3600000,
          geometry: p.points, segments: (p.details.foot_network ?? []).map(([from, to, v]) =>
            ({from, to, network: v, difficulty: null}))};
}

function segColor(seg) {
  const by = $('colorBy').value;
  if (by === 'difficolta') return seg.longChain ? '#b71c1c' : DIFF_COLORS[seg.difficulty] ?? '#757575';
  if (by === 'segnato') return seg.network && seg.network !== 'missing' ? '#2e7d32' : '#9e9e9e';
  if (by === 'fondo') return seg.surface === 'asphalt' ? '#424242' : '#8d6e63';
  const s = Math.abs(seg.slope ?? 0);
  return s > 25 ? '#b71c1c' : s > 15 ? '#ef6c00' : s > 7 ? '#fbc02d' : '#7cb342';
}

function networkShare(r) {
  const n = r.geometry.coordinates.length - 1;
  if (!n || !r.segments?.length) return null;
  return r.segments.filter(s => s.network && s.network !== 'missing').reduce((a, s) => a + s.to - s.from, 0) / n;
}

function draw() {
  routeSource.clear();
  for (const [name, res] of Object.entries(state.results)) {
    const coords = res.geometry.coordinates.map(c => ol.proj.fromLonLat([c[0], c[1]]));
    const segs = res.segments?.length ? res.segments : [{from: 0, to: coords.length - 1}];
    for (const seg of segs) {
      const color = name === 'nuovo' ? segColor(seg) : COLORS[name];
      routeSource.addFeature(new ol.Feature({geometry: new ol.geom.LineString(coords.slice(seg.from, seg.to + 1)),
        style: new ol.style.Style({stroke: new ol.style.Stroke({color, width: name === 'nuovo' ? 5 : 3,
          lineDash: name === 'produzione' ? [8, 6] : undefined})})}));
    }
  }
  for (const p of state.points)
    routeSource.addFeature(new ol.Feature({geometry: new ol.geom.Point(ol.proj.fromLonLat(p)),
      style: new ol.style.Style({image: new ol.style.Circle({radius: 6, fill: new ol.style.Fill({color: '#000'})})})}));
  stats();
  drawProfile();
}

function stats() {
  $('stats').innerHTML = Object.entries(state.results).map(([n, r]) => {
    const share = networkShare(r);
    return `<tr><td>${n}</td><td>${(r.distanceM / 1000).toFixed(2)} km</td><td>+${Math.round(r.ascendM ?? 0)}</td>` +
      `<td>-${Math.round(r.descendM ?? 0)}</td><td>${r.timeH.toFixed(2)} h</td>` +
      `<td>${share === null ? '' : Math.round(share * 100) + '% segnato'}</td>` +
      `<td>${r.unknownShare !== undefined ? Math.round(r.unknownShare * 100) + '% sconosciuto' : ''}</td></tr>`;
  }).join('');
  const nuovo = state.results.nuovo;
  $('warning').textContent = nuovo
    ? nuovo.warning + (nuovo.snowWarning ? ' Sopra i 2000 m la percorribilita\' dipende dalla neve.' : '') : '';
}

function drawProfile() {
  const cv = $('profile'), ctx = cv.getContext('2d');
  cv.width = cv.clientWidth; cv.height = cv.clientHeight;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const all = Object.values(state.results).flatMap(r => r.geometry.coordinates.map(c => c[2] ?? 0));
  if (!all.length) return;
  const lo = Math.min(...all), hi = Math.max(lo + 1, ...all);
  for (const [name, r] of Object.entries(state.results)) {
    const c = r.geometry.coordinates;
    ctx.strokeStyle = COLORS[name]; ctx.beginPath();
    c.forEach((p, i) => {
      const x = (i / Math.max(1, c.length - 1)) * cv.width;
      const y = cv.height - (((p[2] ?? lo) - lo) / (hi - lo)) * (cv.height - 4) - 2;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
}

async function recompute() {
  showError('');
  state.results = {};
  syncUrl();
  if (state.points.length < 2) return draw();
  const which = $('engine').value;
  const jobs = [];
  if (which !== 'produzione') jobs.push(routeNew().then(r => { state.results.nuovo = r; }));
  if (which !== 'nuovo') jobs.push(routeProd().then(r => { state.results.produzione = r; }));
  const out = await Promise.allSettled(jobs);
  const errs = out.filter(o => o.status === 'rejected').map(o => o.reason?.message ?? o.reason);
  if (errs.length) showError(errs.join('\n'));
  draw();
}

function drawLine(geometry, color) {
  const coords = geometry.coordinates.map(c => ol.proj.fromLonLat([c[0], c[1]]));
  routeSource.addFeature(new ol.Feature({geometry: new ol.geom.LineString(coords),
    style: new ol.style.Style({stroke: new ol.style.Stroke({color, width: 4})})}));
}

async function rejoin(position) {
  const base = state.results.nuovo;
  if (!base) return showError('prima calcola un tracciato con il motore nuovo');
  const track = base.geometry.coordinates.map(c => [c[0], c[1]]);
  const r = await fetch(`/v1/${SHARD}/rejoin`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: $('newProfile').value, position, track, progressM: Number($('progress').value),
                          direction: $('direction').value, matchTrack: true})});
  const j = await r.json();
  if (j.stato !== 'rientro') return showError(`rientro: ${j.stato}`);
  drawLine(j.route.geometry, '#00c853');
  if (j.backToReached) drawLine(j.backToReached.geometry, '#00b8d4');
  $('warning').textContent = `rientro a ${(j.joinAtM / 1000).toFixed(2)} km della traccia` +
    (j.offPathM ? `, primo tratto fuori sentiero ${Math.round(j.offPathM)} m` : '') +
    (j.backToReached ? '; in azzurro il ritorno al punto raggiunto' : '');
}

map.on('singleclick', e => {
  const p = ol.proj.toLonLat(e.coordinate);
  if ($('rejoinMode').checked) return rejoin(p).catch(showError);
  state.points.push(p);
  recompute().catch(showError);
});
for (const id of ['engine', 'newProfile', 'prodProfile', 'maxRating', 'maxSlope', 'excludeUnknown'])
  $(id).addEventListener('change', () => recompute().catch(showError));
$('colorBy').addEventListener('change', () => { syncUrl(); draw(); });
for (const id of ['direction', 'progress']) $(id).addEventListener('change', syncUrl);
$('clear').addEventListener('click', () => { state.points = []; recompute().catch(showError); });
map.on('moveend', syncUrl);
loadMeta().then(recompute).catch(showError);
```

- [ ] **Step 3: Controllo verde**

Con gateway e motore dell'area di prova accesi:

Run: `cd gateway && node ../tools/preview-check.mjs`
Expected: `ok: preview caricata`. Poi aprire a mano
`http://localhost:8991/preview/?p=10.2335,44.0490;10.2617,44.0253&motore=entrambi`
e verificare: due tracciati (il nuovo colorato per tratto, la produzione blu
tratteggiata), statistiche con la quota su sentieri segnati, profilo
altimetrico, data dei dati, avvertenza. Con "simula rientro" un clic accanto al
tracciato disegna il rientro in verde e, se proposto, il ritorno in azzurro.

- [ ] **Step 4: Commit**

```bash
git add preview/ tools/preview-check.mjs gateway/package.json gateway/package-lock.json
git commit -m "feat(routing-escursionistico): preview OpenLayers con motore nuovo e produzione a confronto"
```

### Task 9: Percorsi di prova e confronto con la produzione

> ⚠️ L'implementazione ha deviato da questo task: [notes.md](notes.md#task-9-percorsi-di-prova-e-confronto)

**Files:**
- Create: `tools/pick-routes.py`, `tools/compare.mjs`
- Create: `compare/routes.json` (generato), `compare/verdicts.json`
- Test: `gateway/test/compare.test.js`

**Interfaces:**
- Consumes: `/v1/preview/route` (Task 6); produzione `POST /route` con
  `details: ["foot_network"]`.
- Produces: `classify(a, b, thresholds) -> string[]`; `node tools/compare.mjs
  [--giro nome]` scrive `compare/risultati/<giro>.json` ed esce 1 se una
  differenza oltre soglia non ha verdetto. `compare/routes.json` serve anche al
  controllo prima dello scambio (Task 10).

- [ ] **Step 1: Test della classificazione**

`gateway/test/compare.test.js`:

```js
import {it, expect} from 'vitest';
import {classify} from '../../tools/compare.mjs';

const T = {distance: 0.15, ascend: 0.2, network: 0.15};
it('nessuna differenza sotto soglia', () => {
  expect(classify({distanceM: 1000, ascendM: 100, networkShare: 0.5},
                  {distanceM: 1100, ascendM: 110, networkShare: 0.55}, T)).toEqual([]);
});
it('distanza, salita e quota su rete segnata', () => {
  expect(classify({distanceM: 1000, ascendM: 100, networkShare: 0.2},
                  {distanceM: 1300, ascendM: 200, networkShare: 0.6}, T)).toEqual(['distanza', 'salita', 'rete']);
});
```

Run: `cd gateway && npm test -- compare`
Expected: FAIL, `tools/compare.mjs` mancante.

- [ ] **Step 2: Percorsi di prova**

`tools/pick-routes.py` (nel container di `prepare/`): coppie di punti su vie
delle relazioni escursionistiche, distanti fra 2 e 8 km, con un seme fisso.

```python
"""Uso: pick-routes.py <area.osm.pbf> <n> > compare/routes.json"""
import json
import math
import random
import sys

import osmium


class Rels(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = set()

    def relation(self, r):
        if r.tags.get("route") == "hiking":
            self.ways.update(m.ref for m in r.members if m.type == "w")


class Mid(osmium.SimpleHandler):
    def __init__(self, ways):
        super().__init__()
        self.ways, self.coords = ways, []

    def way(self, w):
        if w.id in self.ways:
            n = w.nodes[len(w.nodes) // 2]
            if n.location.valid():
                self.coords.append((round(n.lon, 5), round(n.lat, 5)))


def dist_km(a, b):
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111.32


rels = Rels()
rels.apply_file(sys.argv[1])
mid = Mid(rels.ways)
mid.apply_file(sys.argv[1], locations=True)
pts = sorted(set(mid.coords))
rnd, out, tries = random.Random(42), [], 0
while len(out) < int(sys.argv[2]) and tries < 100_000:
    tries += 1
    a, b = rnd.sample(pts, 2)
    if 2 <= dist_km(a, b) <= 8:
        out.append({"id": f"p{len(out) + 1:02d}", "points": [a, b],
                    "nuovo": "escursionista", "produzione": "hike"})
json.dump(out, sys.stdout, indent=1)
```

Run:

```bash
mkdir -p compare
docker run --rm -v /Users/bongiu/Documents/wm-tiles/data/sources:/in:ro -v "$PWD/tools":/tools:ro \
  wm-routing-prepare python /tools/pick-routes.py /in/area.osm.pbf 30 > compare/routes.json
echo '{}' > compare/verdicts.json
```

Expected: `compare/routes.json` con 30 percorsi.

- [ ] **Step 3: Confronto**

`tools/compare.mjs`:

```js
// Confronto con il GraphHopper di produzione: stessi punti, due motori. Ogni
// differenza oltre soglia va classificata in compare/verdicts.json come
// "voluta" o "difetto", con il motivo; esce 1 se ne resta una senza verdetto.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';

const NEW = process.env.WM_GATEWAY ?? 'http://localhost:8991/v1/preview/route';
const PROD = process.env.WM_PROD ?? 'https://graphhopper.webmapp.it/route';
const THRESHOLDS = {distance: 0.15, ascend: 0.2, network: 0.15};

const rel = (a, b) => Math.abs(a - b) / Math.max(a, b, 1);
export function classify(a, b, t) {
  const out = [];
  if (rel(a.distanceM, b.distanceM) > t.distance) out.push('distanza');
  if (rel(a.ascendM, b.ascendM) > t.ascend) out.push('salita');
  if (Math.abs(a.networkShare - b.networkShare) > t.network) out.push('rete');
  return out;
}

function share(segments, coordsLen, isNetwork) {
  if (coordsLen < 2) return 0;
  let on = 0;
  for (const s of segments) if (isNetwork(s)) on += s.to - s.from;
  return on / (coordsLen - 1);
}

async function post(url, body) {
  const r = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  return {ok: r.ok, json: await r.json().catch(() => ({}))};
}

async function main() {
  const i = process.argv.indexOf('--giro');
  const giro = i > 0 ? process.argv[i + 1] : 'ultimo';
  const routes = JSON.parse(readFileSync('compare/routes.json', 'utf8'));
  const verdicts = JSON.parse(readFileSync('compare/verdicts.json', 'utf8'));
  const rows = [];
  let open = 0;
  for (const r of routes) {
    const [n, p] = await Promise.all([
      post(NEW, {profile: r.nuovo, points: r.points}),
      post(PROD, {profile: r.produzione, points: r.points, points_encoded: false, elevation: true,
                  instructions: false, details: ['foot_network']}),
    ]);
    if (!n.ok || !p.ok) {
      rows.push({id: r.id, esito: `nuovo ${n.ok ? 'ok' : n.json.stato}, produzione ${p.ok ? 'ok' : p.json.message}`});
      continue;
    }
    const pp = p.json.paths[0];
    const a = {distanceM: n.json.distanceM, ascendM: n.json.ascendM,
               networkShare: share(n.json.segments, n.json.geometry.coordinates.length, s => s.network && s.network !== 'missing')};
    const b = {distanceM: pp.distance, ascendM: pp.ascend,
               networkShare: share((pp.details.foot_network ?? []).map(([from, to, v]) => ({from, to, v})),
                                   pp.points.coordinates.length, s => s.v !== 'missing')};
    const diff = classify(a, b, THRESHOLDS);
    const v = verdicts[r.id];
    if (diff.length && !v) open++;
    rows.push({id: r.id, nuovo: a, produzione: b, differenze: diff, verdetto: v?.verdetto ?? null});
  }
  mkdirSync('compare/risultati', {recursive: true});
  writeFileSync(`compare/risultati/${giro}.json`, JSON.stringify(rows, null, 1));
  for (const x of rows)
    console.log([x.id, x.esito ?? '', x.nuovo ? `${Math.round(x.nuovo.distanceM)}/${Math.round(x.produzione.distanceM)} m` : '',
                 (x.differenze ?? []).join(','), x.verdetto ?? ''].join('\t'));
  console.log(`differenze senza verdetto: ${open}`);
  process.exit(open ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

`compare/verdicts.json` ha la forma
`{"p07": {"verdetto": "voluta", "motivo": "il nuovo evita il tratto EE (profilo escursionista)"}}`.

Run: `cd gateway && npm test -- compare && cd .. && node tools/compare.mjs --giro primo`
Expected: test PASS; il confronto stampa una riga per percorso e, al primo
giro, esce 1 con le differenze da classificare. Classificarle guardando i casi
nella preview (`?p=...&motore=entrambi`) e annotare in `notes.md` i difetti.

- [ ] **Step 4: Commit**

```bash
git add tools/pick-routes.py tools/compare.mjs compare/routes.json compare/verdicts.json gateway/test/compare.test.js
git commit -m "feat(routing-escursionistico): percorsi di prova e confronto automatico con la produzione"
```

### Task 10: Costruzione notturna, controllo e scambio del grafo

> ⚠️ L'implementazione ha deviato da questo task: [notes.md](notes.md#task-10-costruzione-notturna-e-scambio)

**Files:**
- Create: `tools/bbox.sh`, `tools/data-stamp.sh`, `tools/gate.mjs`,
  `tools/build-graph.sh`, `tools/check-data.sh`, `tools/log-check.sh`,
  `prepare/check-tiles.py`
- Create: `docker-compose.yml`, `gateway/Dockerfile`

**Interfaces:**
- Consumes: immagini `wm-routing-prepare`, `wm-routing-engine`; `compare/routes.json`.
- Produces: cartelle `$WM_GRAPHS/<data>/` con `graph/`, `ways.sqlite`,
  `terrain.pmtiles`, `stamp.json` (`{"osm", "builtAt", "pbf", "nodes"}`);
  collegamento `$WM_GRAPHS/corrente`; codici d'uscita: 2 dati mancanti o
  incoerenti, 3 controllo fallito, 75 non e' il momento.

- [ ] **Step 1: Data e rettangoli dei dati**

`tools/data-stamp.sh`:

```bash
#!/usr/bin/env bash
# Stampa la data dei dati OSM (osmosis_replication_timestamp, scritta da
# aggiorna-osm.sh di wm-tiles) e controlla che PBF e PMTiles coprano il
# rettangolo del grafo. Esce 2 se manca qualcosa: meglio fermarsi che restare
# in silenzio su un grafo vecchio. Uso: data-stamp.sh <pbf> <terrain.pmtiles>
set -euo pipefail
PBF="$1"; DEM="$2"
source "$(dirname "$0")/bbox.sh"
BBOX="$WM_GRAPH_BBOX"
for f in "$PBF" "$DEM"; do [ -f "$f" ] || { echo "!! file assente: $f" >&2; exit 2; }; done
docker run --rm -i -e WM_STAMP_TS="${WM_STAMP_TS:-}" \
  -v "$(dirname "$PBF")":/in:ro -v "$(dirname "$DEM")":/dem:ro wm-routing-prepare python - \
  "/in/$(basename "$PBF")" "/dem/$(basename "$DEM")" "$BBOX" <<'EOF' || exit 2
import os, sys
import osmium
from pmtiles.reader import MmapSource, Reader
pbf, dem, bbox = sys.argv[1], sys.argv[2], [float(v) for v in sys.argv[3].split(",")]
h = osmium.io.Reader(pbf, osmium.osm.osm_entity_bits.NOTHING).header()
ts = os.environ.get("WM_STAMP_TS") or h.get("osmosis_replication_timestamp", "")
if not ts:
    sys.exit(f"!! {pbf} senza osmosis_replication_timestamp nell'intestazione")
b = h.box()
if b.valid() and not (b.bottom_left.lon <= bbox[0] and b.bottom_left.lat <= bbox[1]
                      and b.top_right.lon >= bbox[2] and b.top_right.lat >= bbox[3]):
    sys.exit(f"!! il PBF non copre il rettangolo del grafo {bbox}: {b}")
with open(dem, "rb") as f:
    head = Reader(MmapSource(f)).header()
if head["min_zoom"] != 13 or head["max_zoom"] != 13:
    sys.exit(f"!! il PMTiles delle quote deve avere solo z13, ha z{head['min_zoom']}-{head['max_zoom']}")
w, s, e, n = (head[k] / 1e7 for k in ("min_lon_e7", "min_lat_e7", "max_lon_e7", "max_lat_e7"))
if not (w <= bbox[0] and s <= bbox[1] and e >= bbox[2] and n >= bbox[3]):
    sys.exit(f"!! il PMTiles non copre il rettangolo del grafo {bbox}: {[w, s, e, n]}")
print(ts)
EOF
```

`WM_STAMP_TS` serve solo per le prove sul Mac con un PBF ritagliato senza
intestazione.

Run: `WM_GRAPH_BBOX=10.0,43.9,10.9,44.5 bash tools/data-stamp.sh /Users/bongiu/Documents/wm-tiles/data/sources/area.osm.pbf data/terrain.pmtiles`
Expected: una data, oppure uscita 2 con il messaggio sull'intestazione
mancante; annotare in `notes.md` quale dei due. Senza `WM_GRAPH_BBOX` esce 2
perche' l'area di prova non copre il rettangolo del grafo, ed e' giusto cosi'.

- [ ] **Step 2: Controllo prima dello scambio**

`tools/gate.mjs`:

```js
// Controllo prima dello scambio: i percorsi di prova devono stare nel
// rettangolo del grafo e riuscire sul grafo nuovo con quote vere, e i nodi non
// devono calare di oltre il 5% rispetto al grafo in uso.
// Uso: node tools/gate.mjs <url motore nuovo> <stamp nuovo> [stamp in uso]
import {readFileSync, existsSync} from 'node:fs';

const [url, stampNew, stampOld] = process.argv.slice(2);
const [w, s, e, n] = (process.env.WM_GRAPH_BBOX ?? '').split(',').map(Number);
if (![w, s, e, n].every(Number.isFinite)) { console.error('!! serve WM_GRAPH_BBOX (tools/bbox.sh)'); process.exit(3); }
const inside = ([x, y]) => x >= w && x <= e && y >= s && y <= n;
const routes = JSON.parse(readFileSync('compare/routes.json', 'utf8')).filter(r => r.points.every(inside));
if (!routes.length) { console.error('!! nessun percorso di prova nel rettangolo del grafo: rigenera compare/routes.json'); process.exit(3); }
const fails = [];
for (const r of routes) {
  const res = await fetch(`${url}/route`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: 'escursionista', points: r.points, points_encoded: false,
                          instructions: false, elevation: true})});
  if (!res.ok) { fails.push(`${r.id} (nessun percorso)`); continue; }
  const ele = (await res.json()).paths[0].points.coordinates.map(c => c[2]);
  const zeros = ele.filter(z => !Number.isFinite(z) || z === 0).length;
  // una quota mancante GraphHopper la mette a 0 in silenzio (OSMReader.java:186)
  if (zeros / ele.length > 0.05) fails.push(`${r.id} (quote a zero: ${zeros}/${ele.length})`);
}
const nodesNew = JSON.parse(readFileSync(stampNew, 'utf8')).nodes;
const nodesOld = stampOld && existsSync(stampOld) ? JSON.parse(readFileSync(stampOld, 'utf8')).nodes : null;
const drop = nodesOld ? (nodesOld - nodesNew) / nodesOld : 0;
if (fails.length || !nodesNew || drop > 0.05) {
  console.error(`!! scambio bloccato: ${fails.join(', ') || 'percorsi ok'}; nodi ${nodesNew} contro ${nodesOld}`);
  process.exit(3);
}
console.log(`controllo superato: ${routes.length} percorsi, nodi ${nodesNew}`);
```

- [ ] **Step 3: Costruzione e scambio**

`tools/build-graph.sh`:

```bash
#!/usr/bin/env bash
# Ritaglia e arricchisce il PBF, costruisce il grafo in una cartella nuova, lo
# controlla e scambia il collegamento "corrente".
# Uso: build-graph.sh <pbf> <terrain.pmtiles>
set -euo pipefail
PBF="$1"; DEM="$2"
cd "$(dirname "$0")/.."
source tools/bbox.sh
ROOT="${WM_GRAPHS:-/var/lib/wm-routing/grafi}"
MIN_GB="${WM_MIN_FREE_GB:-12}"
IMAGE="${WM_ENGINE_IMAGE:-wm-routing-engine:97f7fde}"
CONFIG="${WM_ENGINE_CONFIG:-config.yml}"      # config-cella.yml sulla cella di prova: senza LM

# un lavoro pesante per volta sulla macchina delle tile, senza toccare wm-tiles
if pgrep -f 'build-italia.sh|build-celle.sh' >/dev/null; then
  echo "!! una rigenerazione di wm-tiles e' in corso: rinvio" >&2; exit 75
fi
if [ "$MIN_GB" -gt 0 ]; then
  free_gb=$(awk '/MemAvailable/ {print int($2/1048576)}' /proc/meminfo)
  [ "$free_gb" -ge "$MIN_GB" ] || { echo "!! memoria libera ${free_gb} GB < ${MIN_GB} GB: rinvio" >&2; exit 75; }
fi

TS=$(bash tools/data-stamp.sh "$PBF" "$DEM")
DIR="$ROOT/$(echo "$TS" | tr -d ':')"
mkdir -p "$DIR/quote-cache"     # deve esistere: in sola lettura il motore non puo' crearla
PREP=(docker run --rm --oom-score-adj 900 -e WM_GRAPH_BBOX
      -v "$(dirname "$PBF")":/in:ro -v "$DIR":/out wm-routing-prepare)
"${PREP[@]}" bash clip.sh "/in/$(basename "$PBF")" /out/ritagliato.osm.pbf
"${PREP[@]}" python enrich.py /out/ritagliato.osm.pbf /out/arricchito.osm.pbf /out/ways.sqlite /out/tiles-z13.txt
cp "$DEM" "$DIR/terrain.pmtiles"
# nessuna via deve cadere in una tile senza quote (GraphHopper metterebbe 0)
"${PREP[@]}" python /prepare/check-tiles.py /out/tiles-z13.txt /out/terrain.pmtiles || exit 2
docker run --rm --oom-score-adj 900 --memory "${WM_IMPORT_MEM:-14g}" \
  -e JAVA_OPTS="${WM_IMPORT_JAVA:--Xmx10g}" -v "$DIR":/data -v "$DIR":/graph \
  "$IMAGE" import "$CONFIG"
rm -f "$DIR/ritagliato.osm.pbf" "$DIR/arricchito.osm.pbf"

# avvio di prova su una porta interna, in sola lettura, per i nodi e il controllo
trap 'docker rm -f wm-engine-gate >/dev/null 2>&1 || true' EXIT
docker run -d --name wm-engine-gate -p 127.0.0.1:18990:8989 -v "$DIR":/data:ro -v "$DIR":/graph:ro \
  -e JAVA_OPTS="${WM_ENGINE_JAVA:--Xmx8g} -Ddw.graphhopper.graph.read_only=true" \
  "$IMAGE" server "$CONFIG" >/dev/null
for i in $(seq 180); do curl -fs localhost:18990/health >/dev/null && break; sleep 1; done
# "nodes: 1,234,567(12MB)" (BaseGraphNodesAndEdges.java:568, riga loaded graph di GraphHopperManaged)
NODES=$(docker logs wm-engine-gate 2>&1 | sed -n 's/.*nodes: \([0-9,]*\)(.*/\1/p' | tr -d ',' | head -1)
printf '{"osm":"%s","builtAt":"%s","pbf":"%s","nodes":%s}\n' \
  "$TS" "$(date -u +%FT%TZ)" "$PBF" "${NODES:-0}" > "$DIR/stamp.json"
node tools/gate.mjs http://127.0.0.1:18990 "$DIR/stamp.json" "$ROOT/corrente/stamp.json" || exit 3
docker rm -f wm-engine-gate >/dev/null

ln -sfn "$DIR" "$ROOT/corrente"
WM_ENGINE_CONFIG="$CONFIG" docker compose up -d --force-recreate engine gateway
# si tengono il grafo in uso e quello di prima, per tornare indietro
ls -1d "$ROOT"/20* | sort -r | tail -n +3 | while read -r d; do rm -rf "$d"; done
echo "grafo $TS in uso"
```

Sul numero di nodi: `GraphHopperManaged.java:42-46` scrive a livello INFO
(logger `com.graphhopper.http`, acceso in `config.yml`) `loaded graph at:...`
seguito da `toDetailsString()`, che contiene `nodes: <numero>(<MB>)`, con lo
spazio dopo i due punti. Prova della `sed` sul testo d'esempio:
`echo 'edges: 10(1MB), nodes: 1,234,567(12MB), bounds: x' | sed -n 's/.*nodes: \([0-9,]*\)(.*/\1/p'`
deve stampare `1,234,567`. Lo scambio usa `docker compose up -d
--force-recreate`, che vale anche al primo avvio, quando i servizi non esistono
ancora; i comandi della pulizia funzionano sia con GNU sia su macOS.

`tools/bbox.sh` (l'unico posto in cui e' scritto il rettangolo del grafo):

```bash
# Rettangolo del grafo: DEM di wm-tiles (6.6,35.4,18.6,47.1, build-italia.sh:43)
# con un margine interno. Si legge con `source tools/bbox.sh`.
export WM_GRAPH_BBOX="${WM_GRAPH_BBOX:-6.65,35.45,18.55,47.05}"
```

`prepare/check-tiles.py` (si aggiunge a `prepare/`, quindi all'immagine):

```python
"""Ogni tile z13 toccata dalle vie deve esistere nel PMTiles delle quote:
altrimenti GraphHopper mette quota 0 in silenzio (OSMReader.java:186).
Uso: check-tiles.py <tiles-z13.txt> <terrain.pmtiles>"""
import sys
from pmtiles.reader import MmapSource, Reader

with open(sys.argv[2], "rb") as f:
    reader = Reader(MmapSource(f))
    missing = []
    for line in open(sys.argv[1]):
        x, y = map(int, line.split("/"))
        if reader.get(13, x, y) is None:
            missing.append(f"13/{x}/{y}")
if missing:
    sys.exit(f"!! {len(missing)} tile z13 senza quote, prime: {missing[:20]}")
print("quote presenti per tutte le vie")
```

`tools/check-data.sh`:

```bash
#!/usr/bin/env bash
# Di notte (cron): ricostruisce solo se il PBF e' piu' recente del grafo in uso.
set -euo pipefail
cd "$(dirname "$0")/.."
source tools/bbox.sh
PBF="${WM_PBF:-/data/wm-tiles/sources/italia.osm.pbf}"
DEM="${WM_DEM:-/data/wm-routing/terrain.pmtiles}"
CUR="${WM_GRAPHS:-/var/lib/wm-routing/grafi}/corrente/stamp.json"
TS=$(bash tools/data-stamp.sh "$PBF" "$DEM")
OLD=$( [ -f "$CUR" ] && jq -r .osm "$CUR" || echo "")
[ "$TS" != "$OLD" ] || { echo "grafo gia' aggiornato ($TS)"; exit 0; }
bash tools/build-graph.sh "$PBF" "$DEM"
```

- [ ] **Step 4: Compose e immagine del gateway**

`gateway/Dockerfile`:

```dockerfile
FROM node:20-bookworm-slim
WORKDIR /app/gateway
COPY gateway/package.json gateway/package-lock.json ./
RUN npm ci --omit=dev
COPY gateway/ ./
COPY preview/ /app/preview/
ENV PORT=8991 WM_PREVIEW=/app/preview
CMD ["node", "src/server.js"]
```

`docker-compose.yml`:

```yaml
# Si avvia con `source tools/bbox.sh && docker compose up -d` (lo fa
# build-graph.sh): il rettangolo del grafo sta solo in tools/bbox.sh.
services:
  engine:
    image: "${WM_ENGINE_IMAGE:-wm-routing-engine:97f7fde}"
    command: ["server", "${WM_ENGINE_CONFIG:-config.yml}"]
    environment:
      JAVA_OPTS: "${WM_ENGINE_JAVA:--Xmx8g -Xms8g} -Ddw.graphhopper.graph.read_only=true"
    mem_limit: "${WM_ENGINE_MEM:-12g}"
    volumes:
      - "${WM_GRAPHS:-/var/lib/wm-routing/grafi}/corrente:/graph:ro"
      - "${WM_GRAPHS:-/var/lib/wm-routing/grafi}/corrente:/data:ro"
    restart: unless-stopped
  gateway:
    build: { context: ., dockerfile: gateway/Dockerfile }
    environment:
      WM_ENGINE_URL: http://engine:8989
      WM_WAYS_DB: /graph/ways.sqlite
      WM_STAMP: /graph/stamp.json
      WM_GRAPH_BBOX: "${WM_GRAPH_BBOX:?serve tools/bbox.sh}"
    mem_limit: 512m
    ports: ["127.0.0.1:8991:8991"]
    volumes:
      - "${WM_GRAPHS:-/var/lib/wm-routing/grafi}/corrente:/graph:ro"
    restart: unless-stopped
```

Il motore non pubblica porte: lo raggiunge solo il gateway, sulla rete di
Compose. Con il grafo mappato su file, `mem_limit` comprende heap e page cache:
sotto pressione il kernel libera prima la page cache. I valori si fissano con
le misure dei Task 4 e 11. Le cartelle dei grafi stanno sul disco locale, non
sul Volume.

- [ ] **Step 5: Nessuna coordinata nei log**

`tools/log-check.sh`:

```bash
#!/usr/bin/env bash
# Manda richieste con una coordinata riconoscibile e verifica che non compaia
# nei log di gateway e motore (overview, "Nessuna coordinata nei log").
set -euo pipefail
cd "$(dirname "$0")/.."
source tools/bbox.sh
URL="${1:-http://127.0.0.1:8991}"
MARK="10.2337777"
curl -s "$URL/v1/preview/route" -H 'Content-Type: application/json' \
  -d "{\"profile\":\"escursionista\",\"points\":[[$MARK,44.049],[10.2617,44.0253]]}" >/dev/null || true
curl -s "$URL/v1/preview/rejoin" -H 'Content-Type: application/json' \
  -d "{\"profile\":\"escursionista\",\"position\":[$MARK,44.05],\"track\":[[10.23,44.04],[10.24,44.04]],\"progressM\":0}" >/dev/null || true
curl -s "$URL/v1/preview/route" -H 'Content-Type: application/json' \
  -d "{\"profile\":\"escursionista\",\"points\":[[$MARK,99]]}" >/dev/null || true
sleep 1
if docker compose logs engine gateway 2>&1 | grep -q "$MARK"; then
  echo "!! una coordinata e' finita nei log" >&2; exit 1
fi
echo "ok: nessuna coordinata nei log"
```

- [ ] **Step 6: Prova completa sul Mac**

Run (sul Mac solo l'area di prova; `WM_MIN_FREE_GB=0` salta il controllo della
memoria, perche' `/proc/meminfo` non esiste; `config-cella.yml` tiene la cella
senza LM; `pgrep` funziona anche sul Mac):

```bash
export WM_GRAPHS="$PWD/data/grafi" WM_GRAPH_BBOX=10.0,43.9,10.9,44.5 \
  WM_ENGINE_CONFIG=config-cella.yml WM_ENGINE_JAVA=-Xmx3g WM_ENGINE_MEM=5g
WM_MIN_FREE_GB=0 WM_IMPORT_MEM=6g WM_IMPORT_JAVA=-Xmx4g \
  bash tools/build-graph.sh /Users/bongiu/Documents/wm-tiles/data/sources/area.osm.pbf data/terrain.pmtiles
bash tools/log-check.sh
```

`build-graph.sh` avvia anche i servizi (`docker compose up -d --force-recreate`):
non serve un `docker compose up` a parte.

Se lo Step 1 ha mostrato che `area.osm.pbf` non ha l'intestazione, aggiungere
`WM_STAMP_TS=2026-09-05T00:00:00Z`. Expected: `controllo superato`, `grafo
<data> in uso`, `curl localhost:8991/v1/version` restituisce la stessa data,
`ok: nessuna coordinata nei log`. Durante lo scambio (`docker compose up -d --force-recreate engine`) una
richiesta a `/v1/preview/route` attende e poi risponde, senza `500`.

- [ ] **Step 7: Commit**

```bash
git add tools/data-stamp.sh tools/gate.mjs tools/build-graph.sh tools/check-data.sh tools/log-check.sh \
  docker-compose.yml gateway/Dockerfile
git commit -m "feat(routing-escursionistico): costruzione notturna del grafo con controllo prima dello scambio"
```

### Task 11: Pubblicazione sul server e primo import dell'area intera

**Files:**
- Modify: `/Users/bongiu/Documents/wm-tiles/infra/pubblica-dominio.sh:66-75`
- Modify: `/Users/bongiu/Documents/wm-tiles/docs/runbook.md`
- Create: `infra/pubblica-routing.sh`, `docs/runbook.md`

**Interfaces:**
- Consumes: Caddy del server (`/etc/caddy/Caddyfile`), Compose (Task 10).
- Produces: `/etc/caddy/siti/routing.caddy`; `https://<dominio>/v1/...` e
  `https://<dominio>/preview/`.

- [ ] **Step 1: Il `Caddyfile` di wm-tiles importa il sito del routing**

In `wm-tiles/infra/pubblica-dominio.sh`, prima del `cat > /etc/caddy/Caddyfile`:
`mkdir -p /etc/caddy/siti`; e dentro il testo generato, dopo il blocco
globale: `import /etc/caddy/siti/*.caddy`. Cosi' rilanciare lo script delle
tile non cancella il routing. Nessuna direttiva `log`.

- [ ] **Step 2: Sito del routing**

`infra/pubblica-routing.sh`:

```bash
#!/usr/bin/env bash
# Pubblica il routing dietro il Caddy del server di wm-tiles. Si lancia come
# root sul server: ssh wm-tiles 'DOMINIO=routing.maphub.it bash -s' < infra/pubblica-routing.sh
set -euo pipefail
: "${DOMINIO:?serve DOMINIO}"
grep -q 'import /etc/caddy/siti/\*.caddy' /etc/caddy/Caddyfile \
  || { echo "!! il Caddyfile non importa /etc/caddy/siti: rilancia prima pubblica-dominio.sh di wm-tiles" >&2; exit 1; }
mkdir -p /etc/caddy/siti
cat > /etc/caddy/siti/routing.caddy <<EOF
$DOMINIO {
	encode gzip
	reverse_proxy 127.0.0.1:8991
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy
curl -fsS "https://$DOMINIO/v1/version"
```

- [ ] **Step 3: Runbook**

`docs/runbook.md` di wm-routing, con questi paragrafi:
- **Preparazione**: clone in `/srv/wm-routing`, build delle tre immagini,
  `pack-terrain.py /data/wm-tiles/dem/terrain /data/wm-routing/terrain.pmtiles
  13 6.6,35.4,18.6,47.1` (le tile z13 del server), cartella dei grafi
  `/var/lib/wm-routing/grafi` sul disco locale;
- **Primo avvio**: `build-graph.sh` (costruisce, controlla e avvia i
  servizi), `pubblica-routing.sh`, `log-check.sh`. Ogni comando `docker
  compose` a mano va preceduto da `source tools/bbox.sh`;
- **Cron notturno**: `15 3 * * * /srv/wm-routing/tools/check-data.sh >> /var/log/wm-routing-dati.log 2>&1`;
  codici d'uscita 2 (dati), 3 (controllo), 75 (rinviato);
- **Tornare al grafo precedente**: `ln -sfn <cartella precedente>
  /var/lib/wm-routing/grafi/corrente && source tools/bbox.sh && docker compose
  up -d --force-recreate engine gateway`;
- **Togliere il servizio**: `docker compose down`, cancellare
  `/etc/caddy/siti/routing.caddy`, `systemctl reload caddy`;
- **Spegnimento della produzione**: il criterio dell'overview (meno di 50
  richieste al giorno dalle app per 30 giorni, senza bot ne' preview), da
  contare sul server di `graphhopper.webmapp.it` senza query string.

In `wm-tiles/docs/runbook.md` una riga che rimanda a quello di wm-routing.

- [ ] **Step 4: Primo import dell'area intera**

Ogni comando SSH si mostra al dev e si esegue solo dopo il suo ok. In ordine:
copia del repo sul server; build delle immagini; `pack-terrain.py` come nel
runbook; `pick-routes.py` sull'area intera per rigenerare `compare/routes.json`
(il controllo prima dello scambio li usa); `build-graph.sh
/data/wm-tiles/sources/italia.osm.pbf /data/wm-routing/terrain.pmtiles` con la
memoria ricavata dal Task 4, solo se la stima scritta in `notes.md` (Task 4,
Step 4) rispetta il criterio di stop; `log-check.sh`. Annotare
in `notes.md`: tempo e memoria massima di pre-passo e import, spazio del grafo
e della cache delle quote, nodi, confronto con la stima del Task 4. Decidere
con quei numeri se aggiungere LM ad altri profili.

- [ ] **Step 5: Commit**

In wm-routing:

```bash
git add infra/pubblica-routing.sh docs/runbook.md docs/features/routing-escursionistico/notes.md compare/routes.json
git commit -m "feat(routing-escursionistico): pubblicazione dietro il Caddy del server e primo import"
```

In wm-tiles (repo diverso, commit separato, sempre su conferma):

```bash
git add infra/pubblica-dominio.sh docs/runbook.md
git commit -m "feat(routing-escursionistico): il Caddyfile importa i siti degli altri servizi"
```

# Notes — Routing escursionistico

## Deviazioni dal piano

## Divergenze dal piano, task per task

### Task 1 scheletro del repo

- Il motore si compila con Java 25 (`maven:3.9-eclipse-temurin-25`,
  `eclipse-temurin:25-jre`), non 21: al commit `97f7fde` GraphHopper chiede
  `release 25` e con il JDK 21 la compilazione si ferma ("release version 25
  not supported").

### Task 2 pre-passo sul PBF

- `prepare/pytest.ini` con `pythonpath = .`: senza, pytest non trova
  `difficulty` ed `enrich` dai test in `tests/`.
- `length_m` converte la lista dei nodi in una lista Python e riceve i soli
  nodi con posizione valida: in pyosmium 4 `WayNodeList` non si puo' affettare
  (`TypeError: get(): incompatible function arguments`).
- La prova del ritaglio si fa su `centro.osm.pbf` (Geofabrik) invece che su
  `area.osm.pbf`: l'area di prova e' l'unione di due estratti
  (`merge-extracts.sh` di wm-tiles) e ha relazioni duplicate, che
  `osmium extract` rifiuta ("Relation ID twice in input"). Il pre-passo la
  legge senza problemi. Sul server il PBF nazionale viene da un solo estratto.
- **L'area di prova e' la cella di Pisa** (`10.0,43.0,11.0,44.0`, ritagliata da
  `centro.osm.pbf`), non le Apuane (`area.osm.pbf`): le quote locali di
  wm-tiles (`data/dem/terrain`) coprono solo le due celle di prova, Pisa (lon
  9,98-11,03, lat 42,97-44,02) e Caltanissetta, e le Apuane del piano stanno a
  nord di 44,02 (Passo del Vestito 44,049). I percorsi di prova del piano che
  citano le Apuane si sostituiscono con percorsi del Monte Pisano.
- **Ritaglio con `--strategy simple`, non `complete_ways`.** E' una decisione
  contro una riga dell'overview ("conserva le vie intere al bordo"): con
  `complete_ways` le vie al bordo sporgono oltre il DEM e il controllo delle
  quote trova tile mancanti (3 sulla cella di Pisa; sul confine nazionale
  sarebbero molte di piu'). `simple` taglia le vie al rettangolo: le relazioni
  restano con i pezzi dentro, e la `cai_scale` arriva alle vie dentro. Costo se
  sbagliato: un giro che attraversa il bordo del rettangolo si interrompe li',
  ma li' non ci sarebbero comunque quote.
- Dopo il ritaglio una via puo' citare nodi assenti: `Classify.inside` fa la
  geometria con i soli nodi presenti (test `test_way_cut_by_clip`, via `w18`
  aggiunta alla rete sintetica).

### Task 3 profili e motore sulla rete sintetica

- Il profilo MTB si chiama `mtb_wm.json`: `mtb.json` e' riservato ai profili
  interni di GraphHopper ("Custom model file name 'mtb.json' is already used
  for built-in profiles").
- Il profilo di shard si chiama `prova_escursionista`, non
  `prova--escursionista`: nei nomi GraphHopper ammette solo minuscole, cifre e
  un trattino basso alla volta (`Helper.java:446-462`). Il legame fra shard e
  profilo sta in `shards.json`.
- `config-fixture.yml` ha `prepare.min_network_size: 0`: la rete sintetica e'
  fatta di pezzi minuscoli che GraphHopper altrimenti toglie come sottoreti
  isolate (default 200 nodi).
- Lo smoke test giudica "nessun percorso" dal punto agganciato: un punto su una
  via vietata GraphHopper lo aggancia alla via ammessa piu' vicina e calcola li'
  il percorso, quindi la meta conta come non raggiungibile se il punto
  agganciato dista oltre 30 m da quello chiesto. Per lo stesso motivo il
  gateway dovra' dire all'utente quando un punto e' stato agganciato lontano
  (vedi Follow-up).
- "esperto prende la via breve EE" sostituito da "esperto raggiunge la via EE /
  escursionista no" (un punto a meta' della via EE): `esperto` fra A e B prende
  la via lunga T, perche' `foot_base.json` percorre l'EE a 1,5 km/h e la T a
  4 km/h, e 1.555 m a 4 km/h costano meno di 800 m a 1,5 km/h. E' taratura
  (Follow-up), non un difetto della regola di difficolta'.
- Smoke test: 21 controlli, tutti verdi.

### Task 4 quote a z13 e misure

- `graph.sort: false` in `config.yml` e `config-cella.yml`: al commit
  `97f7fde` l'ordinamento del grafo lungo la curva di Hilbert va in errore con
  i nodi senza archi (`ArrayIndexOutOfBoundsException: Index -1`,
  `BaseGraphNodesAndEdges.java:281`, `getEdgeRef` restituisce -1 e viene usato
  come indice). Spegnerlo costa solo localita' in memoria.
- Sola lettura del grafo con uno script d'avvio (`engine/run.sh`), non con
  `-Ddw.graphhopper.graph.read_only=true`: le chiavi di GraphHopper hanno il
  punto nel nome (`graph.read_only`) e Dropwizard tratta i punti di un
  override come livelli annidati, quindi l'override non arriva
  (`gh.lock (Read-only file system)`). Lo script, con il comando `server`,
  scrive una copia della configurazione con `graph.read_only: true`. Vale anche
  per il gate e il compose (Task 10): niente `-Ddw...read_only`.
- I percorsi di prova sono sul Monte Pisano (cella di Pisa, vedi Task 2): Calci
  (10.5205,43.7244) - Monte Serra (10.5555,43.7505), Monte Serra - Monte
  Faeta (10.4880,43.7660), Asciano (10.4410,43.7930) - Monte Faeta.

### Task 8 preview

- `preview-check.mjs` sta in `gateway/scripts/`, non in `tools/`: in ESM Node
  cerca `playwright` a partire dalla cartella dello script, e il pacchetto e'
  in `gateway/node_modules`.
- Centro di default sul Monte Pisano (`10.53,43.74`) invece che sulle Apuane:
  l'area di prova e' la cella di Pisa (Task 2).
- Tabella delle statistiche a 12 px: a 14 px usciva dal pannello.

### Task 9 percorsi di prova e confronto

- `compare.mjs` chiama `127.0.0.1` invece di `localhost`: Node 18 risolve
  `localhost` in `::1` e il gateway ascolta in IPv4.
- I percorsi di prova sono presi dalla cella di Pisa (`data/pisa.osm.pbf`).

### Task 10 costruzione notturna e scambio

- `data-stamp.sh` e `build-graph.sh` rendono assoluti i percorsi in ingresso:
  con `data/x.pbf` Docker monta `data` come nome di un volume, non come
  cartella.
- `.dockerignore` alla radice (`node_modules`, `data`, `.superpowers`): senza,
  `COPY gateway/ ./` copiava nell'immagine i moduli del Mac e il gateway non
  partiva (`better-sqlite3`, `ERR_DLOPEN_FAILED`).
- `log-check.sh` fallisce se la prima richiesta non arriva al gateway: con il
  gateway fermo il controllo passava a vuoto ("nessuna coordinata").
- Niente `-Ddw.graphhopper.graph.read_only=true` nel gate e nel compose: lo fa
  `engine/run.sh` (Task 4).
- Il PBF ritagliato perde l'intestazione `osmosis_replication_*`
  (`osmium extract` non la copia): non conta, `build-graph.sh` legge la data
  sul PBF di partenza, prima del ritaglio. Sul Mac il PBF di partenza e'
  `centro.osm.pbf` con `WM_GRAPH_BBOX=10.0,43.0,11.0,44.0`.
- Prova completa sul Mac: ritaglio, pre-passo, quote presenti per tutte le vie,
  import, controllo superato (30 percorsi, 297.365 nodi), scambio, avvio con
  Compose; `/v1/version` con la data del PBF; nessuna coordinata nei log; con
  il motore fermo una richiesta aspetta (8,3 s) e risponde 200.

## Bug trovati

- **Il percorso non partiva dal punto cliccato** (segnalato dal dev): il motore
  parte e arriva nel punto agganciato alla via (4 m e 32 m nel caso
  segnalato), e nel rientro la linea partiva dalla via invece che dalla
  persona. Ora il calcolo del tracciato restituisce `connectors` (punto
  chiesto, punto agganciato, distanza) e la preview li disegna punteggiati per
  entrambi i motori; nel rientro il tratto fuori sentiero entra nella geometria
  e nella distanza, come primo segmento con `offTrail: true`, cosi' il rientro
  parte esattamente dalla persona (overview, "rientro sulla traccia"). Test
  "raccordi" e "il rientro parte esattamente dalla persona". Corretto.

- **Percorso rifiutato con tutti i profili** (segnalato dal dev con la
  preview): un punto messo fuori da ogni sentiero (242 m dalla via piu'
  vicina) faceva rispondere `meta_non_raggiungibile` a ogni profilo. Il
  controllo confondeva "punto fuori sentiero" con "meta che il profilo non
  raggiunge". Ora, se un punto e' agganciato a oltre 50 m, il gateway chiede
  l'aggancio anche ad `alpinista`: se anche lui e' lontano, il percorso si da'
  con `offTrailPoints` (punto e distanza) e la preview lo dice; solo se
  `alpinista` aggancia il punto vicino risponde `meta_non_raggiungibile`. Test
  "punto lontano da ogni sentiero" e "il profilo non arriva dove arriva
  alpinista". Corretto.

- **Coordinate nei log del motore** (revisione finale): `com.graphhopper.http`
  a INFO comprendeva `MultiExceptionMapper`, che scrive a INFO le coordinate
  dei punti che non si agganciano (un punto in mare dentro il rettangolo).
  `log-check.sh` non se ne accorgeva perche' nessuna richiesta arrivava al
  motore. Ora a INFO c'e' solo `GraphHopperManaged`, e `log-check.sh` manda un
  percorso valido e un punto in mare che arriva al motore. Corretto.
- **Limite di richieste in un solo secchio dietro Docker** (revisione finale):
  Caddy entra nel container dal bridge (172.x), non da 127.0.0.1;
  `trust proxy` ora e' `['loopback', 'uniquelocal']`. Corretto.
- **Altri dalla revisione finale, corretti**: il rientro valida posizione e
  traccia (`fuori_area`, `traccia_non_valida`, massimo 5.000 punti); al massimo
  10 punti per richiesta (25 per la preview, `maxPoints` dello shard); le
  alternative di `mtb` non propongono profili a piedi; gli errori inattesi
  finiscono nel log senza numeri decimali; se l'intestazione del PBF non ha il
  riquadro, `data-stamp.sh` lo calcola dai dati invece di saltare il
  controllo; `build-graph.sh` rifiuta di ricostruire nella cartella in uso,
  cancella i tentativi bocciati e tiene il grafo in uso e quello di prima.
- **Quota di difficolta' sconosciuta gonfiata** (trovato col confronto, Task 9):
  il gateway contava come "sconosciuta" anche strade e forestali, che una
  difficolta' non ce l'hanno per natura; il percorso p17 risultava "88%
  sconosciuto" ed era tutto su strade. Ora conta solo `road_class == path`,
  come il profilo (test "la difficolta' sconosciuta conta solo sui sentieri").
  Corretto.

- **`pack-terrain.py` non ritagliava** (16 ottobre 2026, sul server): il
  rettangolo finiva solo nell'intestazione e il file della cella di Pisa
  conteneva tutte le 97.544 tile z13 d'Italia (4,6 GB). Ora prende solo le tile
  che toccano il rettangolo.

## Decisioni

- **Punteggio del rientro**: tempo di rientro piu' due volte il tempo del
  tratto di traccia saltato, invece di "rientro + resto del giro" dell'overview:
  con il resto del giro vince sempre il candidato piu' lontano (la linea d'aria
  verso di lui e' piu' corta del giro). Concordato con il revisore Fable sul
  piano; test "traccia dritta senza ostacoli".
- **Ghiacciai**: una via e' "nel ghiacciaio" se interseca il poligono, anche
  solo sul bordo (prudente).
- **Meta non raggiungibile** (aggiunta dopo la revisione, d'accordo con il dev):
  se un punto agganciato dal motore dista piu' di 50 m da quello chiesto, il
  calcolo del tracciato risponde `404 {"stato": "meta_non_raggiungibile",
  "punto": <indice>, "suggerimento": <profilo successivo>}` invece di un giro
  verso un altro posto. Il rientro non lo applica, perche' li' la distanza dalla
  via e' il tratto "fuori sentiero". Provato: `prudente` da Calci al Monte Serra
  ora risponde cosi' e suggerisce `escursionista`; i 30 percorsi di prova non
  cambiano.
- **Tappe dai punti di interesse delle tile** (d'accordo con il dev, solo nella
  preview): un clic su un'icona dei livelli `rifugi`, `osmpoi`,
  `mountain_peak` o `poi` di wm-tiles usa le coordinate esatte e il nome del
  punto come tappa ("Monte Serra · cima · 917 m"); passandoci sopra un tooltip
  lo dice. Le localita' vengono per ultime. Si fa tutto in OpenLayers
  (`forEachFeatureAtPixel` sui livelli vettoriali), senza toccare tile o
  motore. Limite: le icone che OpenLayers nasconde perche' si sovrappongono non
  si possono cliccare. I nomi delle tappe non stanno nell'URL.
- **Mai senza percorso** (richiesta del dev, 16 ottobre 2026): se il giro non
  riesce con il profilo scelto, il gateway lo calcola tratto per tratto (da un
  punto al successivo) e il tratto che non riesce passa al profilo successivo
  (`next` in `profiles.json`: escursionista -> esperto -> alpinista -> libero;
  prova_escursionista -> esperto; mtb -> libero). La risposta dichiara
  `fallbackLegs` e ogni segmento porta il suo `profile`. Sul caso dei 12 punti
  del Monte Pisano: escursionista 24,7 km con i tratti 8-9 e 9-10 calcolati con
  esperto; prima rispondeva `meta_non_raggiungibile`. Resta un 404 solo se un
  tratto non riesce nemmeno con `libero` (rete scollegata).
- **Profilo `libero`** (richiesta del dev): qualsiasi via percorribile a piedi
  per legge (`foot_access`), di qualunque difficolta', vie ferrate e ghiacciai
  compresi, sentieri sconosciuti senza penalita', velocita' uguale ovunque (la
  via piu' corta). 7 controlli nuovi nello smoke test (28 in tutto).
- **Preview spiegata** (richiesta del dev): sezioni numerate con una riga di
  aiuto, legende delle linee e dei colori (difficolta', segnato, fondo,
  pendenza, origine del dato), punti numerati e rimovibili, descrizione di
  motore e profilo, schede dei risultati con riepilogo per difficolta' e per
  origine, tabella dei tratti cliccabile (raggruppati per difficolta', origine,
  tipo di via, segnaletica e profilo), tooltip in italiano, assi del profilo
  altimetrico, errori in italiano, area dei dati come riquadro rosso
  (`/v1/version` ora porta `area`). Controllo: `gateway/scripts/preview-ux-check.mjs`.
- **Pendenza come preferenza** (scelta del dev, 16 ottobre 2026): oltre
  `max_slope` il tratto costa x0,3 invece di essere escluso, come chiede
  l'overview; il piano l'aveva reso un divieto. Profili a piedi alla versione 2.
- **I 53 km di `prudente` non dipendevano dalla pendenza** (diagnosi corretta):
  con la pendenza come preferenza restano 53 km; con la difficolta' massima
  alzata a E (limite di prova `maxHikeRating: 2`) diventano 9,1 km con arrivo a
  884 m accanto alla vetta. Al Monte Serra si sale solo su sentieri E, e
  `prudente` ammette solo T: GraphHopper aggancia l'arrivo alla via T piu'
  vicina, a 900 m dalla vetta, e ci costruisce un giro lungo, senza avvisare.

- `.superpowers/` in `.gitignore`: e' la cartella di lavoro dell'esecuzione
  del piano, non va nel repo.

## Follow-up

- **Rimandati dalla revisione finale** (minori): il map matching fallito usa la
  traccia grezza senza dirlo; la mappa dei secchi del limite di richieste non
  si svuota mai; i limiti di prova non stanno nell'URL della preview;
  `NODE_ENV=production` nel Dockerfile del gateway; origini delle WebView
  (`capacitor://localhost`, `http://localhost`, `ionic://localhost`) e dei
  clienti da mettere in `shards.json` prima che un'app usi il servizio; sul
  server la preview ha LM su `escursionista`, quindi un limite di prova che
  allenta il profilo arriva come `richiesta_non_valida`; `GH_COMMIT` con l'hash
  intero; `gate.mjs` con il profilo del percorso (`r.nuovo`); lock in
  `check-data.sh`; attesa del certificato dopo il reload di Caddy; i verdetti
  "da confermare" come terzo stato invece di "voluta".
- **Preferenze che allungano troppo** (p03, p17, p21: +26-39% di distanza a
  parita' di difficolta'): da tarare con la preview i pesi di `foot_base.json`
  (0,67 fuori rete, 0,3 strade principali, 0,8 asfalto).
- **Salita da validare** con tracce GPS note: scegliere finestra di
  levigatura (150 o 300 m) e confermare che il 67% della produzione e' piu'
  vicino al vero.
- **Velocita' sui tratti EE**: `foot_base.json` (da `hike.json` di GraphHopper)
  mette 1,5 km/h oltre E, cosi' anche `esperto` evita una scorciatoia EE di
  meta' lunghezza. Da tarare con la preview.

- Memoria del pre-passo sull'area intera: ridotta e da misurare sul server
  al primo import (Misure, "Memoria del pre-passo").

## Misure

### Pre-passo sull'area di prova (16 ottobre 2026, Mac)

- `area.osm.pbf` (68 MB): 182.116 vie `highway`; origine `cai` 17.451, `sac`
  2.393, `via_ferrata` 15, sconosciuta 162.257 (comprese strade e forestali,
  che non hanno difficolta' per natura); 134 zone militari, 0 ghiacciai; 1.840
  catene di sentieri sconosciuti oltre 500 m; 13 `horse_scale` originali;
  580 tile z13 toccate.
- 42 s, 373 MB di memoria massima.
- Cella di Pisa (`centro.osm.pbf` ritagliato con `simple`, 62 MB): 184.273 vie
  `highway`, `cai` 6.983, `sac` 1.592, `via_ferrata` 4, 167 zone militari,
  1.565 catene lunghe, 523 tile z13, tutte con quote; 329 MB di memoria
  massima. 663 relazioni `route=hiking`.

### Memoria del pre-passo (16 ottobre 2026, Mac)

Sulla cella di Pisa (62 MB, 7,1 milioni di nodi) da 329 MB a 268 MB, con
risultato identico (`ways.sqlite` e `tiles-z13.txt` uguali byte per byte):
- la passata 1 montava i poligoni sul file intero, tenendo in memoria tutte le
  vie (248 MB): ora le relazioni si leggono senza posizioni e i poligoni su un
  estratto `osmium tags-filter` con soli ghiacciai e zone militari (54 MB);
- per via un intero solo (bit della difficolta' e tre segnali) invece di un
  dizionario, e le righe della tabella scritte a blocchi di 50.000;
- l'indice delle posizioni dei nodi su file (`WM_NODE_INDEX=sparse_file_array`,
  16 byte per nodo: 117 MB qui, nella cartella del grafo, cancellato dopo).
  `dense_*` no: vuole 8 byte per l'id di nodo piu' alto (oltre 13 miliardi,
  cioe' 100 GB).
Restano in memoria circa 135 MB anonimi, di cui 30 di tabelle Python (184 mila
vie, 190 mila nodi di sentieri sconosciuti): sul nazionale, se crescono in
proporzione, qualche GB, sotto il tetto di 12 GB del container
(`WM_PREP_MEM`) che lo fa fallire prima di togliere memoria alle tile.

### Motore sulla cella di Pisa (16 ottobre 2026, Mac)

- Import senza LM: 9,4 s; grafo 35 MB, cache delle quote 31 MB; 297.365 nodi.
- Import con LM su `escursionista`: 14,3 s; `landmarks_escursionista` 19,9 MB,
  cioe' 67 byte per nodo (la stima era 64); grafo 55 MB in tutto.
- PMTiles z13 della cella: 1.512 tile, 112 MB; z14: 5.658 tile, 384 MB.
- Quote: Calci 59 m, Monte Serra 851 m al punto agganciato (vetta 917 m),
  coerenti: la sorgente `pmtiles` legge Terrarium.
- Salita e discesa (escursionista) su tre percorsi del Monte Pisano:

  | Variante | Calci-Serra | Serra-Faeta | Asciano-Faeta |
  |---|---|---|---|
  | z13, moving_average 150 m | +885 -94 | +207 -506 | +572 -416 |
  | z13, senza levigatura | +898 -107 | +293 -593 | +673 -519 |
  | z13, moving_average 300 m | +884 -91 | +194 -494 | +547 -391 |
  | z14, moving_average 150 m | +883 -90 | +209 -510 | +577 -422 |

  z14 cambia la salita di meno dell'1%: z13 resta. Senza levigatura la salita
  cresce fino al 40% (rumore del DEM). Tracce GPS di riferimento non ne
  abbiamo: la scelta fra 150 e 300 m resta da confermare con tracce note.
- `prudente` da Calci al Monte Serra: 53 km, arrivo agganciato a 900 m dalla
  vetta; la causa e' la difficolta' (solo T), non la pendenza (vedi Decisioni).
  `escursionista` 9 km con tratti al 31,5%.

### Confronto con la produzione, cella di Pisa (16 ottobre 2026)

30 percorsi di prova (2-8 km in linea d'aria, punti su sentieri CAI), profilo
`escursionista` contro `hike` della produzione:
- **rete segnata**: in media +38 punti percentuali sul motore nuovo (es. Calci -
  Monte Serra: 92% contro 14%, la produzione sale sulla strada provinciale);
- **salita**: in media il 67% della produzione. Il DEM e' diverso (TINITALY
  10 m levigato contro il DEM della produzione) e senza levigatura la nostra
  salita cresce fino al 40%: quale dei due e' piu' vicino al vero lo diranno
  tracce GPS note;
- **distanza** oltre il 15% in 6 casi: tre (p01, p24, p30) perche'
  `escursionista` evita tratti EE o catene lunghe di sconosciuti (con `esperto`
  o `alpinista` la distanza torna pari o piu' corta della produzione), tre
  (p03, p17, p21) per le preferenze del profilo, uguali con tutti i profili.
Tutte classificate "voluta" in `compare/verdicts.json`; secondo giro: 0
differenze senza verdetto.

### Stima per l'area intera (prima del Task 11)

Proporzione sui nodi: la cella di Pisa (circa 8.000 km2 di terra) ha 297 mila
nodi, circa 37 per km2. L'area del grafo ha circa 300 mila km2 di terra
italiana piu' le fasce di confine: ordine di grandezza 11-15 milioni di nodi.
Con 118 byte per nodo per il grafo e 67 per profilo con LM: grafo 1,3-1,8 GB,
LM su un profilo 0,7-1,0 GB, cache delle quote qualche GB su disco. **Criterio
di stop**: sopra 20 GB residenti nessun profilo con LM; la stima resta molto
sotto, quindi LM su `escursionista` e, se la misura sul server lo conferma,
anche su `mtb`. Il pre-passo e' il punto piu' pesante (Follow-up sulla
memoria) e va misurato sul server prima dell'import.

- Ritaglio di `centro.osm.pbf` su `10.2,44.0,10.5,44.2`: 1,5 s, 193 relazioni
  `route=hiking`, rettangolo dei dati `9.88,43.84,10.71,44.24` (le vie al bordo
  restano intere).

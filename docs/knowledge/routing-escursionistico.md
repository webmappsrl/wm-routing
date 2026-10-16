# Routing escursionistico

## Come funziona oggi

Esercizio, aggiornamento e ritorno indietro: [docs/runbook.md](../runbook.md).
Requisiti: [overview](../features/routing-escursionistico/overview.md).

- **GraphHopper dal ramo principale, commit `97f7fde`, Java 25**: la sorgente
  di quote `pmtiles` (Terrarium) non c'e' nella 11.1 rilasciata. Nessun codice
  Java nostro: cio' che GraphHopper non sa ricavare si scrive nel PBF prima
  dell'import (`prepare/enrich.py`).
- **Difficolta' nel tag `sac_scale`**, che GraphHopper legge come
  `hike_rating`: via ferrata e ghiacciaio 6, poi `cai_scale` massima fra le
  relazioni, poi `sac_scale` della via, poi sconosciuta (0);
  `trail_visibility` cattiva alza di un grado. Le catene di sentieri
  sconosciuti oltre 500 m stanno in `horse_scale=impossible` (`horse_rating`
  6), che nessun profilo usa per il suo significato. I valori originali sono in
  `ways.sqlite`, che il gateway rimette nei dettagli tramite `osm_way_id`.
- **Grafo sul rettangolo del DEM** (`tools/bbox.sh`), ritagliato con
  `--strategy simple`; prima dell'import ogni tile z13 toccata dalle vie deve
  avere le quote (`prepare/check-tiles.py`).
- **Quote da un PMTiles a z13** delle tile Terrarium di wm-tiles, con
  `pmtiles.zoom: 13` esplicito e `moving_average` a 150 m.
- **Profili**: preferenze e divieti fissi sul server; LM solo su
  `escursionista`; la cella di prova e la preview senza LM
  (`config-cella.yml`). Il gateway (`/v1`) fa autorizzazione, inoltro e
  rientro; tempo a piedi DIN 33466 sui totali.
- **Meta non raggiungibile**: se il motore aggancia un punto a oltre 50 m da
  quello chiesto (il profilo non ci arriva), il gateway risponde
  `meta_non_raggiungibile` con il profilo successivo, invece di restituire un
  giro verso un altro posto.
- **Sullo stesso server di wm-tiles**: grafo mappato su file e in sola lettura
  (`engine/run.sh`), import con priorita' di chiusura alta, nessun passo negli
  script di wm-tiles; il sito Caddy sta in `/etc/caddy/siti/routing.caddy`.

## Perche' cosi'

- **Pre-passo invece di parser Java**: la web app di GraphHopper crea il motore
  con `new GraphHopper()` scritto nel codice (`GraphHopperManaged.java`), quindi
  un parser nostro vorrebbe dire riscrivere il bundle.
- **z13 e non z14**: GraphHopper legge la quota ai nodi e ogni 60 m; misurato
  sul Monte Pisano, z14 cambia la salita di meno dell'1% e costa 3,4 volte lo
  spazio.
- **`simple` e non `complete_ways`**: con le vie intere il bordo sporge oltre il
  DEM e quei tratti avrebbero quota 0 (GraphHopper la mette in silenzio).
- **Rientro con tre candidati e il tratto saltato pesato il doppio**: con il
  "resto del giro" nel punteggio vinceva sempre il candidato piu' lontano.
- **Preferenze nel profilo, non per richiesta**: con LM una richiesta puo' solo
  restringere un profilo (`docs/core/custom-models.md` di GraphHopper).

## Come ci siamo arrivati

- **Parametri liberi nell'app** (superata): l'utente sceglie solo un profilo;
  cinque profili si capiscono e si possono provare, combinazioni libere no.
- **Compatibilita' con le app di oggi** (superata): le app vecchie restano sul
  GraphHopper di produzione; l'adattatore serve solo per spegnerlo.
- **Estendere il DEM con Copernicus fuori dal rettangolo** (scartata): la fascia
  persa (Provenza interna, Tirolo del nord, Slavonia) non ha giri di confine
  rilevanti, e le zone che contano stanno dentro.
- **12 candidati nel rientro** (superata): troppo carico per richiesta, e una
  cache di posizioni avrebbe contraddetto "nessuna coordinata conservata".
- **Lucchetto condiviso negli script di wm-tiles** (scartata): avrebbe toccato la
  pipeline di wm-tiles; al suo posto memoria libera, `pgrep` e `oom_score_adj`.

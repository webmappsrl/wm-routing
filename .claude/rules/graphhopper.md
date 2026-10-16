---
paths:
  - "engine/**"
  - "tools/build-graph.sh"
  - "docker-compose.yml"
---

# Trappole: GraphHopper

- Un custom model con il nome di un profilo interno (`mtb.json`, `foot.json`, `hike.json`, `bike.json`, `car.json`...) blocca l'avvio ("already used for built-in profiles"): usare un nome proprio, come `mtb_wm.json`
- Nei nomi dei profili solo minuscole, cifre e un `_` alla volta (`Helper.java:446-462`): `prova--x` e `prova__x` fermano l'avvio, `prova_x` va
- Un parametro gia' dichiarato in un file precedente dello stesso profilo blocca l'avvio (`GraphHopper.java:1793-1796`): i parametri stanno solo nel file del singolo profilo, mai in `foot_base.json`
- Un punto su una via vietata dal profilo viene agganciato alla via ammessa piu' vicina, senza errore: per sapere se la meta e' raggiungibile si confronta `snapped_waypoints` con il punto chiesto
- Senza `graph.elevation.pmtiles.zoom` le quote si leggono a z11 (`PMTilesElevationProvider.java:168`), in silenzio: va sempre scritto

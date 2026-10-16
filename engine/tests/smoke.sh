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
  # Un punto su una via vietata GraphHopper lo aggancia alla via ammessa piu'
  # vicina: se il punto agganciato dista oltre 30 m da quello chiesto, la meta
  # non e' raggiungibile con quel profilo.
  curl -s localhost:18988/route -H 'Content-Type: application/json' -d \
    "{\"profile\":\"$1\",\"points\":[$2,$3],\"points_encoded\":false}" \
  | jq -r --argjson a "$2" --argjson b "$3" '
      def far(p; q): (((p[0]-q[0])*80000)|fabs) + (((p[1]-q[1])*111000)|fabs) > 30;
      if .paths then
        (.paths[0].snapped_waypoints.coordinates) as $s
        | if far($s[0]; $a) or far($s[1]; $b) then "nessuno" else (.paths[0].distance|floor) end
      else "nessuno" end'
}
A='[10.000,44.000]'; B='[10.010,44.000]'; C='[10.014,44.000]'; D='[10.010,44.008]'
E='[10.000,43.990]'; F='[9.990,44.000]'; H='[10.010,43.990]'; K='[9.990,44.008]'
M='[9.998,44.012]'; V='[10.016,43.996]'; Q='[10.020,44.004]'
fail=0
ok()   { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (atteso $3, avuto $2)"; fail=1; fi; }
some() { if [ "$2" != nessuno ]; then echo "ok   $1"; else echo "FAIL $1 (nessun percorso)"; fail=1; fi; }
lt()   { if [ "$2" != nessuno ] && [ "$2" -lt "$3" ]; then echo "ok   $1"; else echo "FAIL $1 ($2)"; fail=1; fi; }
gt()   { if [ "$2" != nessuno ] && [ "$2" -gt "$3" ]; then echo "ok   $1"; else echo "FAIL $1 ($2)"; fail=1; fi; }

W1='[10.005,44.000]'   # meta' della via breve EE, raggiungibile solo da li'
some "esperto raggiunge la via EE"              "$(route esperto "$A" "$W1")"
ok   "escursionista non raggiunge la via EE"    "$(route escursionista "$A" "$W1")" nessuno
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
                                                "$(route prova_escursionista "$A" "$B")" nessuno
some "libero entra nella catena lunga"            "$(route libero "$A" "$K")"
some "libero entra nel ghiacciaio"                 "$(route libero "$B" "$D")"
some "libero passa sulla via ferrata"              "$(route libero "$B" "$Q")"
some "libero usa il sentiero sconosciuto"          "$(route libero "$B" "$C")"
ok   "libero rispetta foot=no"                     "$(route libero "$A" "$F")" nessuno
ok   "libero rispetta la zona militare"            "$(route libero "$A" "$M")" nessuno
lt   "libero prende la via breve EE"               "$(route libero "$A" "$B")" 1000
exit $fail

#!/usr/bin/env bash
# Stampa la data dei dati OSM (osmosis_replication_timestamp, scritta da
# aggiorna-osm.sh di wm-tiles) e controlla che PBF e PMTiles coprano il
# rettangolo del grafo. Esce 2 se manca qualcosa: meglio fermarsi che restare
# in silenzio su un grafo vecchio. Uso: data-stamp.sh <pbf> <terrain.pmtiles>
set -euo pipefail
abs() { [ -f "$1" ] && echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" || echo "$1"; }
# percorsi assoluti: con "data/x" Docker leggerebbe "data" come nome di un volume
PBF=$(abs "$1"); DEM=$(abs "$2")
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
if b.valid():
    box = [b.bottom_left.lon, b.bottom_left.lat, b.top_right.lon, b.top_right.lat]
else:
    # aggiorna-osm.sh e osmium extract senza --set-bounds non scrivono il
    # riquadro: lo si calcola dai dati (legge tutto il file, qualche minuto
    # sul PBF nazionale) invece di saltare il controllo
    import subprocess
    out = subprocess.run(["osmium", "fileinfo", "-e", "-g", "data.bbox", pbf],
                         capture_output=True, text=True, check=True).stdout.strip()
    box = [float(v) for v in out.strip("()").split(",")]
if not (box[0] <= bbox[0] and box[1] <= bbox[1] and box[2] >= bbox[2] and box[3] >= bbox[3]):
    sys.exit(f"!! il PBF non copre il rettangolo del grafo {bbox}: {box}")
with open(dem, "rb") as f:
    head = Reader(MmapSource(f)).header()
if head["min_zoom"] != 13 or head["max_zoom"] != 13:
    sys.exit(f"!! il PMTiles delle quote deve avere solo z13, ha z{head['min_zoom']}-{head['max_zoom']}")
w, s, e, n = (head[k] / 1e7 for k in ("min_lon_e7", "min_lat_e7", "max_lon_e7", "max_lat_e7"))
if not (w <= bbox[0] and s <= bbox[1] and e >= bbox[2] and n >= bbox[3]):
    sys.exit(f"!! il PMTiles non copre il rettangolo del grafo {bbox}: {[w, s, e, n]}")
print(ts)
EOF

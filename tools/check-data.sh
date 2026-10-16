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

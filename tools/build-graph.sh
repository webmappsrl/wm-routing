#!/usr/bin/env bash
# Ritaglia e arricchisce il PBF, costruisce il grafo in una cartella nuova, lo
# controlla e scambia il collegamento "corrente".
# Uso: build-graph.sh <pbf> <terrain.pmtiles>
# Con WM_REBUILD_SAME_DATA=1 ricostruisce anche se il dato OSM e' lo stesso di quello in uso
# (serve dopo una modifica a prepare/: cambia il codice, non il dato). Il grafo nuovo va in una
# cartella con un nome diverso, "<data>-r<ora della build>"; quello in uso non si tocca.
set -euo pipefail
abs() { [ -f "$1" ] && echo "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" || echo "$1"; }
# percorsi assoluti: con "data/x" Docker leggerebbe "data" come nome di un volume
PBF=$(abs "$1"); DEM=$(abs "$2")
cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
source tools/bbox.sh
ROOT="${WM_GRAPHS:-/var/lib/wm-routing/grafi}"
MIN_GB="${WM_MIN_FREE_GB:-12}"
IMAGE="${WM_ENGINE_IMAGE:-wm-routing-engine:97f7fde}"
CONFIG="${WM_ENGINE_CONFIG:-config.yml}"      # config-cella.yml sulla cella di prova: senza LM

# una sola build per volta: la pulizia finale cancella ogni cartella che non sia la propria o quella in
# uso, quindi cancellerebbe quella di un'altra build in corso. Lock non bloccante e uscita 75, come gli
# altri rinvii: chi lancia (cron o a mano) riprova dopo, senza restare appeso per ore a una build lunga.
# Il lock sta sul file descriptor 9 e si rilascia da solo all'uscita, anche se lo script muore.
mkdir -p "$ROOT"
exec 9>"$ROOT/.build.lock"
if ! flock -n 9; then
  echo "!! un'altra build del grafo e' in corso: rinvio" >&2; exit 75
fi

# un lavoro pesante per volta sulla macchina delle tile, senza toccare wm-tiles
if pgrep -f 'build-italia.sh|build-celle.sh' >/dev/null; then
  echo "!! una rigenerazione di wm-tiles e' in corso: rinvio" >&2; exit 75
fi
if [ "$MIN_GB" -gt 0 ]; then
  free_gb=$(awk '/MemAvailable/ {print int($2/1048576)}' /proc/meminfo)
  [ "$free_gb" -ge "$MIN_GB" ] || { echo "!! memoria libera ${free_gb} GB < ${MIN_GB} GB: rinvio" >&2; exit 75; }
fi

TS=$(bash tools/data-stamp.sh "$PBF" "$DEM")
STAMP_DIR=$(echo "$TS" | tr -d ':')
CUR=$(readlink "$ROOT/corrente" 2>/dev/null || true)
# il collegamento puo' essere relativo: si confrontano sempre i nomi delle cartelle, mai i percorsi
CUR_NAME=$(basename "${CUR:-/}")
# la data del grafo in uso si legge dal nome, senza l'eventuale "-r<ora>" di una ricostruzione:
# cosi' "stesso dato" vale anche dopo una ricostruzione, non solo alla prima
CUR_STAMP=${CUR_NAME%%-r*}
if [ "$STAMP_DIR" = "$CUR_STAMP" ]; then
  if [ "${WM_REBUILD_SAME_DATA:-0}" != 1 ]; then
    if [ ! -d "$ROOT/$CUR_NAME" ]; then
      echo "!! corrente punta a $CUR_NAME, che non esiste: nessun grafo in uso, da ripristinare a mano." >&2
      exit 2
    fi
    echo "!! il grafo $TS e' gia' in uso: non lo si ricostruisce nella sua cartella." >&2
    echo "   Se e' cambiato il codice del pre-passo (prepare/) e il dato e' lo stesso, si chiede" >&2
    echo "   esplicitamente: WM_REBUILD_SAME_DATA=1 bash tools/build-graph.sh <pbf> <terrain.pmtiles>" >&2
    echo "   (prima va ricostruita l'immagine: docker build -t wm-routing-prepare prepare/)" >&2
    exit 2
  fi
  # stesso dato, codice diverso: cartella con un nome che non puo' essere quello in uso
  STAMP_DIR="$STAMP_DIR-r$(date -u +%Y%m%dT%H%M%SZ)"
fi
DIR="$ROOT/$STAMP_DIR"
# ultima rete, sul nome e non sul percorso (il collegamento puo' essere relativo): prima del rm -rf
# qui sotto la cartella nuova non puo' avere il nome di quella in uso
if [ "$STAMP_DIR" = "$CUR_NAME" ]; then
  echo "!! la cartella del grafo nuovo coincide con quella in uso ($DIR): mi fermo" >&2; exit 2
fi
rm -rf "$DIR"                   # resti di un tentativo precedente con lo stesso nome
SWAPPED=0
# un tentativo non riuscito non deve restare su disco (sul nazionale: decine di GB)
cleanup() {
  docker rm -f wm-engine-gate >/dev/null 2>&1 || true
  if [ "$SWAPPED" = 0 ]; then rm -rf "$DIR"; fi
}
trap cleanup EXIT
mkdir -p "$DIR/quote-cache"     # deve esistere: in sola lettura il motore non puo' crearla
# il tetto fa fallire il pre-passo prima che tolga memoria alle tile (Pisa: 280 MB)
# shellcheck disable=SC2054  # le virgole sono dentro il valore di WM_NODE_INDEX, non separano elementi
PREP=(docker run --rm --oom-score-adj 900 --memory "${WM_PREP_MEM:-12g}" -e WM_GRAPH_BBOX
      -e WM_NODE_INDEX=sparse_file_array,/out/nodi.idx
      -v "$(dirname "$PBF")":/in:ro -v "$DIR":/out wm-routing-prepare)
"${PREP[@]}" bash clip.sh "/in/$(basename "$PBF")" /out/ritagliato.osm.pbf
# indice delle posizioni dei nodi su file, nella cartella del grafo (disco locale):
# in memoria sul nazionale non starebbe
"${PREP[@]}" python enrich.py /out/ritagliato.osm.pbf /out/arricchito.osm.pbf /out/ways.sqlite /out/tiles-z13.txt \
  | tee "$DIR/prepare.json"   # il riassunto resta accanto al grafo: lo legge il controllo
rm -f "$DIR/nodi.idx"
cp "$DEM" "$DIR/terrain.pmtiles"
# nessuna via deve cadere in una tile senza quote (GraphHopper metterebbe 0)
"${PREP[@]}" python /prepare/check-tiles.py /out/tiles-z13.txt /out/terrain.pmtiles || exit 2
docker run --rm --oom-score-adj 900 --memory "${WM_IMPORT_MEM:-14g}" \
  -e JAVA_OPTS="${WM_IMPORT_JAVA:--Xmx10g}" -v "$DIR":/data -v "$DIR":/graph \
  "$IMAGE" import "$CONFIG"
rm -f "$DIR/ritagliato.osm.pbf" "$DIR/arricchito.osm.pbf"

# avvio di prova su una porta interna, in sola lettura (engine/run.sh), per i nodi e il controllo
docker run -d --name wm-engine-gate -p 127.0.0.1:18990:8989 -v "$DIR":/data:ro -v "$DIR":/graph:ro \
  -e JAVA_OPTS="${WM_ENGINE_JAVA:--Xmx8g}" \
  "$IMAGE" server "$CONFIG" >/dev/null
for _ in $(seq 180); do curl -fs localhost:18990/health >/dev/null && break; sleep 1; done
# "nodes: 1,234,567(12MB)" (BaseGraphNodesAndEdges.java:568, riga loaded graph di GraphHopperManaged)
NODES=$(docker logs wm-engine-gate 2>&1 | sed -n 's/.*nodes: \([0-9,]*\)(.*/\1/p' | tr -d ',' | head -1)
printf '{"osm":"%s","builtAt":"%s","pbf":"%s","nodes":%s}\n' \
  "$TS" "$(date -u +%FT%TZ)" "$PBF" "${NODES:-0}" > "$DIR/stamp.json"
node tools/gate.mjs http://127.0.0.1:18990 "$DIR/stamp.json" "$ROOT/corrente/stamp.json" \
  "$DIR/prepare.json" "$ROOT/corrente/prepare.json" || exit 3
docker rm -f wm-engine-gate >/dev/null

ln -sfn "$DIR" "$ROOT/corrente"
SWAPPED=1
WM_ENGINE_CONFIG="$CONFIG" docker compose up -d --force-recreate engine gateway
# si tengono il grafo in uso e quello che era in uso prima, per tornare indietro
for d in "$ROOT"/20*; do
  [ -d "$d" ] || continue
  [ "$d" = "$DIR" ] || [ "$(basename "$d")" = "$CUR_NAME" ] || rm -rf "$d"
done
echo "grafo $TS in uso"

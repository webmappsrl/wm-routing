#!/usr/bin/env bash
# Manda richieste con coordinate riconoscibili e verifica che non compaiano nei
# log di gateway e motore (overview, "Nessuna coordinata nei log"). Le
# richieste devono arrivare davvero al motore: un percorso valido (dai percorsi
# di prova; vale per le rotte /v1, non per /g/*, vedi sotto) e un punto in mare nell'angolo sud-ovest del rettangolo, che il
# motore non riesce ad agganciare e che GraphHopper descriverebbe nel suo log.
set -euo pipefail
cd "$(dirname "$0")/.."
source tools/bbox.sh
URL="${1:-http://127.0.0.1:8991}"
IFS=, read -r W S E N <<< "$WM_GRAPH_BBOX"
SEA_LON=$(awk -v w="$W" 'BEGIN{printf "%.7f", w + 0.0337777}')
SEA_LAT=$(awk -v s="$S" 'BEGIN{printf "%.7f", s + 0.0337777}')
OK=$(jq -c '.[0].points' compare/routes.json)
post() { curl -s -o /dev/null -w '%{http_code}' "$URL/v1/preview/$1" -H 'Content-Type: application/json' -d "$2" || true; }
code=$(post route "{\"profile\":\"escursionista\",\"points\":$OK}")
[ "$code" = 200 ] || { echo "!! il percorso valido non riesce (HTTP $code): controllo non valido" >&2; exit 1; }
code=$(post route "{\"profile\":\"escursionista\",\"points\":[[$SEA_LON,$SEA_LAT],$(jq -c '.[0].points[1]' compare/routes.json)]}")
case "$code" in 404|400) ;; *) echo "!! il punto in mare doveva arrivare al motore e fallire (HTTP $code)" >&2; exit 1;; esac
post rejoin "{\"profile\":\"escursionista\",\"position\":[$SEA_LON,$SEA_LAT],\"track\":$OK,\"progressM\":0}" >/dev/null

# Rotte nuove: /g/ e /g/gpx portano il blob firmato in query string, /mcp il
# token. Blob e token sono dati da non loggare quanto le coordinate.
# giro_finale e /g/scheda* ricevono osmId e note scritte dal modello: si
# provano con un osmId e una nota inconfondibili.
NOTA="NOTA-DA-NON-LOGGARE-xyz"; OSMID=1733141336
TESTO="TESTO-DELL-ASSISTENTE-DA-NON-LOGGARE-xyz"
BLOB=""; BLOB_POI=""; TOKEN=""
if [ -f .env ]; then
  KEY=$(grep '^WM_LINK_KEY=' .env | cut -d= -f2 || true)
  TOKEN=$(grep '^WM_MCP_TOKEN=' .env | cut -d= -f2 || true)
  if [ -n "${KEY:-}" ]; then
    BLOB=$(cd gateway && node -e "import('./src/mcp/link.js').then(m => console.log(m.encodeLink({points: [[$SEA_LON, $SEA_LAT], [$SEA_LON, $SEA_LAT]], profile: 'escursionista', stamp: 'X'}, '$KEY')))")
    curl -s -o /dev/null "$URL/g/?t=$BLOB" || true
    curl -s -o /dev/null "$URL/g/gpx?t=$BLOB" || true
    # blob con i POI: punti DENTRO l'area coperta, cosi' le rotte /g/* attraversano
    # davvero il percorso di successo (calcolo, risoluzione dei POI, pagina) e non
    # si fermano al 400 di parse(). Le risposte si asseriscono, come per /v1.
    BLOB_POI=$(cd gateway && node -e "import('./src/mcp/link.js').then(m => console.log(m.encodeLink({points: $OK, profile: 'escursionista', stamp: 'X', poi: [{osmId: $OSMID, nota: '$NOTA'}]}, '$KEY')))")
    for r in g/gpx g/scheda g/scheda.json; do
      code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/$r?t=$BLOB_POI" || true)
      [ "$code" = 200 ] || { echo "!! /$r col blob dei POI dovrebbe rispondere 200 (HTTP $code): controllo non valido" >&2; exit 1; }
    done
    code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/g/?t=$BLOB_POI" || true)
    [ "$code" = 302 ] || { echo "!! /g/ col blob dei POI dovrebbe rispondere 302 (HTTP $code): controllo non valido" >&2; exit 1; }
    # il blob col punto in mare prova l'altro percorso, quello d'errore
    for r in g/gpx g/scheda.json; do
      code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/$r?t=$BLOB" || true)
      case "$code" in 400|404) ;; *) echo "!! /$r col punto in mare doveva fallire (HTTP $code)" >&2; exit 1;; esac
    done
  fi
  if [ -n "${TOKEN:-}" ]; then
    curl -s -o /dev/null -X POST "$URL/mcp?t=$TOKEN" -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"route\",\"arguments\":{\"points\":[[$SEA_LON,$SEA_LAT],[$SEA_LON,$SEA_LAT]],\"profile\":\"escursionista\"}}}" || true
    curl -s -o /dev/null -X POST "$URL/mcp?t=$TOKEN" -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{\"name\":\"giro_finale\",\"arguments\":{\"points\":[[$SEA_LON,$SEA_LAT],[$SEA_LON,$SEA_LAT]],\"profile\":\"escursionista\",\"poi\":[{\"osmId\":$OSMID,\"nota\":\"$NOTA\"}]}}}" || true
    # documento_giro riceve il blob e il testo scritto dall'assistente: ne' l'uno
    # ne' l'altro devono comparire nei log
    if [ -n "${BLOB_POI:-}" ]; then
      curl -s -o /dev/null -X POST "$URL/mcp?t=$TOKEN" -H 'Content-Type: application/json' \
        -H 'Accept: application/json, text/event-stream' \
        -d "{\"jsonrpc\":\"2.0\",\"id\":11,\"method\":\"tools/call\",\"params\":{\"name\":\"documento_giro\",\"arguments\":{\"t\":\"$BLOB_POI\",\"introduzione\":\"$TESTO\",\"luoghi\":[{\"osmId\":$OSMID,\"testo\":\"$TESTO\"}]}}}" || true
    fi
  fi
fi

sleep 1
LOGS=$(docker compose logs engine gateway 2>&1)
# confronto a stringa fissa su un frammento lungo (5 decimali): il vecchio
# pattern corto con il punto jolly combaciava coi timestamp dei log
if echo "$LOGS" | grep -qF -e "${SEA_LON%??}" -e "${SEA_LAT%??}"; then
  echo "!! una coordinata e' finita nei log" >&2; exit 1
fi
if [ -n "$BLOB" ] && echo "$LOGS" | grep -qF "${BLOB:0:24}"; then
  echo "!! il blob firmato e' finito nei log" >&2; exit 1
fi
if [ -n "$BLOB_POI" ]; then
  echo "$LOGS" | grep -qF "${BLOB_POI:0:24}" && { echo "!! il blob con i POI e' finito nei log" >&2; exit 1; }
  echo "$LOGS" | grep -qF "$NOTA" && { echo "!! la nota di un POI e' finita nei log" >&2; exit 1; }
  echo "$LOGS" | grep -qF "$OSMID" && { echo "!! un osmId e' finito nei log" >&2; exit 1; }
  echo "$LOGS" | grep -qF "$TESTO" && { echo "!! il testo dell'assistente e' finito nei log" >&2; exit 1; }
fi
if [ -n "$TOKEN" ] && echo "$LOGS" | grep -qF "$TOKEN"; then
  echo "!! il token della rotta /mcp e' finito nei log" >&2; exit 1
fi
echo "ok: nessuna coordinata nei log (comprese /g/, /g/scheda*, /mcp route, giro_finale e documento_giro: ne' blob, ne' osmId, ne' note, ne' testo dell'assistente)"

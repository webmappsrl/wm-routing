#!/usr/bin/env bash
# Manda richieste con coordinate riconoscibili e verifica che non compaiano nei
# log di gateway e motore (overview, "Nessuna coordinata nei log"). Le
# richieste devono arrivare davvero al motore: un percorso valido (dai percorsi
# di prova) e un punto in mare nell'angolo sud-ovest del rettangolo, che il
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
BLOB=""; TOKEN=""
if [ -f .env ]; then
  KEY=$(grep '^WM_LINK_KEY=' .env | cut -d= -f2 || true)
  TOKEN=$(grep '^WM_MCP_TOKEN=' .env | cut -d= -f2 || true)
  if [ -n "${KEY:-}" ]; then
    BLOB=$(cd gateway && node -e "import('./src/mcp/link.js').then(m => console.log(m.encodeLink({points: [[$SEA_LON, $SEA_LAT], [$SEA_LON, $SEA_LAT]], profile: 'escursionista', stamp: 'X'}, '$KEY')))")
    curl -s -o /dev/null "$URL/g/?t=$BLOB" || true
    curl -s -o /dev/null "$URL/g/gpx?t=$BLOB" || true
  fi
  if [ -n "${TOKEN:-}" ]; then
    curl -s -o /dev/null -X POST "$URL/mcp?t=$TOKEN" -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"route\",\"arguments\":{\"points\":[[$SEA_LON,$SEA_LAT],[$SEA_LON,$SEA_LAT]],\"profile\":\"escursionista\"}}}" || true
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
if [ -n "$TOKEN" ] && echo "$LOGS" | grep -qF "$TOKEN"; then
  echo "!! il token della rotta /mcp e' finito nei log" >&2; exit 1
fi
echo "ok: nessuna coordinata nei log (comprese le rotte /g/ e /mcp)"

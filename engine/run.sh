#!/bin/sh
# Avvio del motore. Con "server" il grafo si apre in sola lettura
# (graph.read_only: niente gh.lock, GraphHopper.java:1219-1229), cosi' la
# cartella del grafo si monta :ro. La chiave ha un punto nel nome e un
# override -Ddw.* di Dropwizard non la raggiunge: si scrive in una copia.
set -e
cmd="$1"; cfg="$2"; shift 2
if [ "$cmd" = server ]; then
  sed 's/^graphhopper:$/graphhopper:\n  graph.read_only: true/' "/app/$cfg" > /tmp/server.yml
  grep -q 'graph.read_only: true' /tmp/server.yml || { echo "!! graph.read_only non scritto in $cfg" >&2; exit 1; }
  cfg=/tmp/server.yml
fi
exec java $JAVA_OPTS -jar /app/graphhopper-web.jar "$cmd" "$cfg" "$@"

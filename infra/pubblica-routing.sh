#!/usr/bin/env bash
# Pubblica il routing dietro il Caddy del server di wm-tiles. Si lancia come
# root sul server: ssh wm-tiles 'DOMINIO=routing.maphub.it bash -s' < infra/pubblica-routing.sh
#
# Questo script e' la sola fonte di /etc/caddy/siti/routing.caddy: lo riscrive da
# zero a ogni lancio. Tutto cio' che quel file deve contenere sta qui dentro, le
# attenzioni per /mcp comprese (infra/mcp.md). Una modifica fatta a mano sul
# server sparisce al rilancio successivo.
set -euo pipefail
: "${DOMINIO:?serve DOMINIO}"
grep -q 'import /etc/caddy/siti/\*.caddy' /etc/caddy/Caddyfile \
  || { echo "!! il Caddyfile non importa /etc/caddy/siti: rilancia prima pubblica-dominio.sh di wm-tiles" >&2; exit 1; }
mkdir -p /etc/caddy/siti
# heredoc senza apici: $DOMINIO si espande. Qualunque altro $ qui dentro va
# scritto \$, altrimenti la shell lo mangia prima che il file sia scritto.
cat > /etc/caddy/siti/routing.caddy <<EOF
$DOMINIO {
	encode gzip
	# /v1/<shard>/poi serve al backend di Walkiria, che gira su questa macchina e
	# raggiunge il gateway dalla rete interna (127.0.0.1:8991): da internet non
	# deve esistere. 404 e non 403, perche' un 403 confermerebbe che la rotta c'e'.
	# Le due forme: senza stella in coda Caddy confronta il percorso in modo esatto,
	# ed Express serve anche lo slash finale, che altrimenti aggirerebbe la regola.
	@interne path /v1/*/poi /v1/*/poi/
	respond @interne 404
	# /mcp e' il transport streamable HTTP del connettore MCP: la risposta SSE resta
	# aperta anche per minuti e non va bufferizzata (infra/mcp.md), da qui
	# flush_interval -1 e read_timeout 0. Il blocco sta prima del reverse_proxy
	# generico per chiarezza e per non dipendere da come l'adapter ordina le route.
	@mcp path /mcp
	reverse_proxy @mcp 127.0.0.1:8991 {
		flush_interval -1          # niente buffering: gli eventi SSE passano subito
		transport http {
			read_timeout 0         # la risposta puo' restare aperta a lungo
		}
	}
	reverse_proxy 127.0.0.1:8991
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy
curl -fsS "https://$DOMINIO/v1/version"
# La protezione delle rotte interne va dimostrata, non solo scritta: finche' non
# risponde 404 da internet, questa configurazione non deve restare pubblicata.
# Il 404 di Caddy ha corpo vuoto; un 404 col corpo verrebbe dal gateway, cioe' la
# richiesta sarebbe passata e il matcher non starebbe funzionando.
for percorso in /v1/walkiria/poi /v1/walkiria/poi/; do
  esito=$(curl -s -o /dev/null -w '%{http_code} %{size_download}' "https://$DOMINIO$percorso?lon=10.5&lat=43.75" || true)
  [ "$esito" = "404 0" ] \
    || { echo "!! https://$DOMINIO$percorso ha risposto '$esito' invece di '404 0': la rotta interna e' raggiungibile da internet" >&2; exit 1; }
done
echo "ok: $DOMINIO pubblicato, /mcp senza buffering, /v1/*/poi non raggiungibile da internet"

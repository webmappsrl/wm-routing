#!/usr/bin/env bash
# Pubblica il routing dietro il Caddy del server di wm-tiles. Si lancia come
# root sul server: ssh wm-tiles 'DOMINIO=routing.maphub.it bash -s' < infra/pubblica-routing.sh
set -euo pipefail
: "${DOMINIO:?serve DOMINIO}"
grep -q 'import /etc/caddy/siti/\*.caddy' /etc/caddy/Caddyfile \
  || { echo "!! il Caddyfile non importa /etc/caddy/siti: rilancia prima pubblica-dominio.sh di wm-tiles" >&2; exit 1; }
mkdir -p /etc/caddy/siti
cat > /etc/caddy/siti/routing.caddy <<EOF
$DOMINIO {
	encode gzip
	reverse_proxy 127.0.0.1:8991
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy
curl -fsS "https://$DOMINIO/v1/version"

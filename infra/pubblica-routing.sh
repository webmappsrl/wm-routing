#!/usr/bin/env bash
# Pubblica il routing dietro il Caddy del server di wm-tiles. Si lancia come
# root sul server: ssh wm-tiles 'DOMINIO=routing.maphub.it bash -s' < infra/pubblica-routing.sh
# Se il gateway ha la credenziale accesa serve anche WM_V1_TOKEN, mai scritto in
# chiaro sulla riga di comando: vedi docs/runbook.md, "La credenziale delle rotte
# dei dati".
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
# I percorsi che da internet non devono esistere: un elenco solo, letto sia dalla
# regola di Caddy qui sotto sia dalla prova che la verifica piu' in basso. Il * e'
# il nome dello shard. Ogni percorso ha due forme, con e senza slash finale:
# senza stella in coda Caddy confronta il percorso in modo esatto, ed Express serve
# anche lo slash finale, che altrimenti aggirerebbe la regola.
INTERNI="/v1/*/poi /v1/*/poi/ /v1/*/places /v1/*/places/ /v1/*/areas /v1/*/areas/"
# heredoc senza apici: $DOMINIO si espande. Qualunque altro $ qui dentro va
# scritto \$, altrimenti la shell lo mangia prima che il file sia scritto.
cat > /etc/caddy/siti/routing.caddy <<EOF
$DOMINIO {
	encode gzip
	# /v1/<shard>/poi, /places e /areas servono al backend di Walkiria, che gira su questa macchina e
	# raggiunge il gateway dalla rete interna (127.0.0.1:8991): da internet non
	# deve esistere. 404 e non 403, perche' un 403 confermerebbe che la rotta c'e'.
	# L'elenco e le due forme di ogni percorso sono in INTERNI, in cima allo script.
	@interne path $INTERNI
	respond @interne 404
	# /mcp e' il transport streamable HTTP del connettore MCP. Oggi risponde con un
	# JSON solo (enableJsonResponse in gateway/src/mcp/http.js), quindi flush_interval
	# e read_timeout non hanno effetto: restano perche' non costano nulla e servirebbero
	# subito se si togliesse quel flag per avere streaming vero (infra/mcp.md).
	# Il blocco sta prima del reverse_proxy generico per chiarezza e per non dipendere
	# da come l'adapter ordina le route.
	@mcp path /mcp
	reverse_proxy @mcp 127.0.0.1:8991 {
		flush_interval -1          # niente buffering, se un giorno la risposta sara' SSE
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
# risponde 404 da internet, il rilascio e' fermo: lo script esce con errore, ma il
# file e il reload di Caddy sono gia' avvenuti e non vengono ritirati. Un rilascio
# con questa prova rossa va fermato e rivisto a mano.
# Il 404 di Caddy ha corpo vuoto; un 404 col corpo verrebbe dal gateway, cioe' la
# richiesta sarebbe passata e il matcher non starebbe funzionando.
set -f   # il * di INTERNI e' un segnaposto, non un glob da espandere sul disco
for modello in $INTERNI; do
  percorso="${modello//\*/walkiria}"
  esito=$(curl -s -o /dev/null -w '%{http_code} %{size_download}' "https://$DOMINIO$percorso?lon=10.5&lat=43.75" || true)
  [ "$esito" = "404 0" ] \
    || { echo "!! https://$DOMINIO$percorso ha risposto '$esito' invece di '404 0': la rotta interna e' raggiungibile da internet" >&2; exit 1; }
done
set +f

# La credenziale delle rotte dei dati (docs/runbook.md, "La credenziale delle rotte
# dei dati"). Si chiede al servizio, con una richiesta SENZA intestazione: nessun
# segreto parte mai, e lo script non stampa mai il valore di WM_V1_TOKEN. Una
# richiesta puo' dare tre cose, e la terza e' la delicata:
#   401                        credenziale accesa
#   200, 400, 429              risposta del gateway che nessuno ha autorizzato: aperte
#   altro (000, 5xx, 404, 403, ...) la prova non ha misurato niente. La lista dei
#   codici che contano e' chiusa: un 404 puo' venire da uno shard sconosciuto, che
#   il gateway scarta prima di guardare la credenziale, e leggerlo come "aperte"
#   o come "accesa" sarebbe un falso
# Lo script gira subito dopo un reload. Il gateway in se' e' gia' stato toccato dal
# curl su /v1/version qui sopra (se e' giu', lo script muore li'); i tentativi
# coprono quello che resta, un 502/503 transitorio di Caddy fra le due chiamate.
# L'esito non misurato si ritenta e, se resta tale, lo script esce con errore.
# Mai letto come "aperte" ne' come "accesa".
# Se la prova deve sbagliare, sbaglia dalla parte del blocco.
TENTATIVI="${TENTATIVI:-6}"
ATTESA="${ATTESA:-2}"
codice=000
for tentativo in $(seq 1 "$TENTATIVI"); do
  codice=$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://$DOMINIO/v1/walkiria/route" || true)
  case "$codice" in 401|200|400|429) break ;; esac
  [ "$tentativo" -lt "$TENTATIVI" ] && sleep "$ATTESA"
done
case "$codice" in
  401) stato=accesa ;;
  200|400|429) stato=aperte ;;
  *) echo "!! la prova della credenziale non ha misurato niente: dopo $TENTATIVI tentativi l'ultimo esito e' '$codice' (solo 401, 200, 400 e 429 sono una misura). La configurazione di Caddy e' valida e le rotte interne gia' verificate (404): a non aver funzionato e' la misura, quasi sempre il gateway. Controlla il gateway e rifai la prova rilanciando lo script; la configurazione resta pubblicata, e per tornare indietro si rilancia lo script della release precedente" >&2; exit 1 ;;
esac
if [ -n "${WM_V1_TOKEN:-}" ]; then
  # Il token e' nell'ambiente dello script: il gateway deve chiederlo.
  [ "$stato" = accesa ] \
    || { echo "!! WM_V1_TOKEN e' presente ma il gateway ha risposto $codice a una richiesta senza intestazione invece di 401: le rotte /v1 sono aperte" >&2; exit 1; }
  # Lunghezza minima. Il 401 non passa dal limite di richieste: il gateway lo fa
  # di proposito, per non spendere una quota su una richiesta che non si
  # autentica. Quindi un token si puo' provare a raffica, senza alcun freno, e
  # l'unica difesa rimasta e' che sia lungo e casuale.
  [ "${#WM_V1_TOKEN}" -ge 32 ] \
    || { echo "!! WM_V1_TOKEN e' lungo ${#WM_V1_TOKEN} caratteri, ne servono almeno 32 (nessun freno ai tentativi sul 401)" >&2; exit 1; }
  credenziale="rotte /v1 con credenziale"
else
  # Token assente: il gateway non deve chiederlo. Se lo chiede, lo script e il
  # gateway non sono d'accordo su come stanno le cose.
  [ "$stato" = aperte ] \
    || { echo "!! WM_V1_TOKEN non e' nell'ambiente dello script ma il gateway risponde 401: lo script e il gateway non sono d'accordo, passa lo stesso token a entrambi" >&2; exit 1; }
  echo "ATTENZIONE: WM_V1_TOKEN assente, le rotte /v1 sono aperte a chiunque (risposta $codice senza intestazione)"
  credenziale="rotte /v1 APERTE"
fi
echo "ok: $DOMINIO pubblicato, /mcp senza buffering, $INTERNI non raggiungibili da internet, $credenziale"

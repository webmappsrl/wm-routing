# La rotta MCP sul server

La rotta `/mcp` (transport streamable HTTP del server MCP) e la rotta `/g/`
(link firmati e GPX) viaggiano sul gateway esistente, dietro lo stesso Caddy
di `routing.maphub.it`. Niente servizio nuovo.

## Variabili d'ambiente (segreti fuori dal repo)

Nell'environment del compose sul server (`/srv/wm-routing/.env`, mai
committato — `.env` e' in `.gitignore`):

| Variabile | Cosa | Esempio |
|---|---|---|
| `WM_LINK_KEY` | chiave di firma dei link `/g/` | `openssl rand -hex 24` |
| `WM_MCP_ENABLED` | interruttore della rotta `/mcp` | `1` acceso, qualsiasi altro valore spento |
| `WM_MCP_TOKEN` | token d'accesso in query string (`/mcp?t=...`) | `openssl rand -hex 16` |
| `WM_PUBLIC_URL` | base dei link consegnati all'utente | `https://routing.maphub.it` |

Accendere/spegnere: cambiare `WM_MCP_ENABLED` e
`docker compose up -d gateway` (senza `--build` se il codice non e' cambiato).
Ruotare il token: nuovo `WM_MCP_TOKEN`, stesso riavvio; i connector collegati
col token vecchio smettono di funzionare subito. I link `/g/` gia' consegnati
restano validi: dipendono da `WM_LINK_KEY`, non dal token.

## Caddy: transport streamable HTTP

Sul path `/mcp` il blocco Caddy ha due attenzioni, `flush_interval -1` e
`read_timeout 0`, ma **oggi non servono**, e vale la pena sapere perche': il
transport e' creato con `enableJsonResponse: true` (`gateway/src/mcp/http.js`),
quindi risponde con **un JSON solo**, non con uno stream SSE.

Misurato in produzione su `tools/list`: attraverso Caddy il primo byte arriva a
136 ms e il totale a 136 ms; dal gateway diretto, 12 ms e 12 ms. Primo byte e
totale che coincidono sono la prova che la risposta esce in un colpo solo, e la
differenza fra i due percorsi e' TLS piu' il giro di rete, non buffering.

Le due direttive restano perche' non costano nulla e servirebbero subito se un
giorno si togliesse `enableJsonResponse` per avere streaming vero: in quel caso
la risposta resterebbe aperta a lungo e senza di esse arriverebbe bufferizzata e
troncata. Toglierle vorrebbe dire doversene ricordare allora.

**Non si configura a mano.** Il blocco `/mcp` sta in
[`infra/pubblica-routing.sh`](pubblica-routing.sh), che riscrive
`/etc/caddy/siti/routing.caddy` da zero ed è la sola fonte di quel file: una
modifica fatta sul server sparirebbe al rilancio successivo dello script, e il
connettore si romperebbe senza che nessuno capisca perché. Per cambiare qualcosa
in quel blocco si cambia lo script e lo si rilancia (`docs/runbook.md`,
«Rilascio»).

Regola invariata: Caddy non logga query string (il blob di `/g/`, il token di
`/mcp` e le coordinate di `/v1/*/poi` ci viaggiano dentro). Di Caddy, però, non
c'è un controllo automatico: `tools/log-check.sh` legge
`docker compose logs engine gateway`, cioè i log del gateway e del motore, e
verifica che lì non finiscano coordinate, blob, token, osmId né note. La
copertura dipende da dove gira: `/v1/*/route`, `/v1/*/rejoin` e `/v1/*/poi` le
interroga sempre; `/g/`, `/g/scheda*` e `/mcp` solo se lo si lancia dalla
cartella del repo sul server, dove c'è un `.env` con `WM_LINK_KEY` e
`WM_MCP_TOKEN` — altrimenti quelle sonde si saltano, e il messaggio finale dello
script elenca solo ciò che ha davvero interrogato.

## Claude: collegare il connector

Su claude.ai → Settings → Connectors → Add custom connector, con URL:

```
https://routing.maphub.it/mcp?t=<WM_MCP_TOKEN>
```

Il collaudo manuale e' in
[docs/howto/collaudo-connector-mcp.md](../docs/howto/collaudo-connector-mcp.md).

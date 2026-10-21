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

Il transport MCP tiene la risposta aperta (SSE) anche per minuti. Nel blocco
del sito (`/etc/caddy/siti/routing.caddy`) servono due attenzioni sul path
`/mcp`:

```caddy
@mcp path /mcp
reverse_proxy @mcp 127.0.0.1:8991 {
    flush_interval -1          # niente buffering: gli eventi SSE passano subito
    transport http {
        read_timeout 0         # la risposta puo' restare aperta a lungo
    }
}
```

Il resto del sito non cambia. Regola invariata: Caddy non logga query string
(il blob di `/g/` e il token di `/mcp` ci viaggiano dentro) —
`tools/log-check.sh` lo verifica anche per le rotte nuove.

## Claude: collegare il connector

Su claude.ai → Settings → Connectors → Add custom connector, con URL:

```
https://routing.maphub.it/mcp?t=<WM_MCP_TOKEN>
```

Il collaudo manuale e' in
[docs/howto/collaudo-connector-mcp.md](../docs/howto/collaudo-connector-mcp.md).

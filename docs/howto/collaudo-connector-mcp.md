# Collaudo manuale del connector MCP

Il livello deterministico (tool chiamati senza AI, confronto con `/v1` vivo)
sta in `gateway/scripts/mcp-check.mjs`. Questo e' il livello due: la prova
con un'AI vera, periodica e dopo ogni cambio ai tool o alle istruzioni.
Non e' un test automatico: un modello varia tra un run e l'altro per natura.

## Preparazione

- **In locale (stdio):** il server e' registrato in Claude Code
  (`claude mcp list` deve mostrare `wm-routing`); il gateway locale gira
  (`curl -s http://127.0.0.1:8991/v1/version`).
- **Online (connector):** la rotta e' accesa (`WM_MCP_ENABLED=1`) e il
  connector e' collegato su claude.ai con l'URL col token (vedi
  [infra/mcp.md](../../infra/mcp.md)).

## La richiesta campione

> «Voglio progettare un'escursione col profilo libero da San Giuliano Terme
> al Monte Serra. Preparami il giro.»

(La versione con le coordinate, se l'AI non riesce a geolocalizzare: partenza
lon 10.4420 lat 43.7625, arrivo lon 10.5503 lat 43.7521.)

## Checklist

- [ ] L'AI ha chiamato il tool `route` (non ha risposto a memoria).
- [ ] I numeri in chat (km, dislivello, ore) coincidono con l'output del tool
  — si rileggono dal dettaglio della chiamata nella chat.
- [ ] L'AI ha incollato `linkPreview` intatto; il link apre la preview col
  giro ricostruito e il parametro `d` (banner «dati cambiati» assente se il
  grafo non e' stato rigenerato nel frattempo).
- [ ] `linkGpx` scarica un GPX che si apre (traccia con quote, tappe).
- [ ] Un link manomesso a mano (una lettera cambiata nel `t=`) da' la pagina
  «link alterato», non un giro.
- [ ] Richiesta fuori area («da Milano al lago di Como»): l'AI riferisce che
  l'area coperta e' un'altra, senza inventare un itinerario.
- [ ] Nei log del gateway (`docker compose logs gateway`) nessuna coordinata,
  nessun blob, nessun token — `bash tools/log-check.sh` come controprova.

Esito e stranezze si annotano in
`docs/features/mcp-progettazione-escursioni/notes.md`.

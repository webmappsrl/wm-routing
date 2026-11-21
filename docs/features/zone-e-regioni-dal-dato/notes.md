> Stato: in corso

# Le zone e le regioni dal dato — note

## Impronta dell'overview approvata

impronta `ab09c2e36396cd5009935e366ae09aa1841d2d97` — `docs/features/zone-e-regioni-dal-dato/overview.md`, approvata il
2026-11-21 con i requisiti da `R1` a `R11`.

Si rilegge con `git cat-file -p ab09c2e36396cd5009935e366ae09aa1841d2d97`.

## Modifiche ai requisiti

Nessuna finora.

## Divergenze dal piano

Nessuna finora.

## Bug trovati

Nessuno finora.

## Decisioni

- **La credenziale di `/v1` e' un token nell'intestazione `Authorization`, non una
  chiave in query string.** `WM_MCP_TOKEN` sta in query string perche' il
  connettore MCP non sa mandare intestazioni; qui chi chiama e' codice nostro, e
  una query string finisce nei log di chiunque stia in mezzo.
- **`WM_V1_TOKEN` assente lascia le rotte aperte** invece di impedire l'avvio: sul
  Mac il gateway deve partire senza segreti. Che quello stato non arrivi in
  produzione lo garantisce la prova in `infra/pubblica-routing.sh` (`R10`), non il
  codice del gateway.
- **La tabella `area` ha la chiave composta `(osm_type, osm_id)`.** In OSM un way
  e una relation possono avere lo stesso id; la tabella `poi` ha `osm_id` da solo
  e oggi non se ne accorge perche' legge solo nodi.
- **L'estrazione delle aree non e' fail-soft**, al contrario di `extract_pois`: un
  errore ferma il pre-passo. Il fail-soft dei POI resta com'e', e a renderlo
  visibile pensa il controllo prima dello scambio (`R11`).
- **Il controllo prima dello scambio confronta i riassunti JSON del pre-passo**, non
  `ways.sqlite`: `better-sqlite3` sta nelle dipendenze del gateway e `tools/` gira
  con il node nudo.

## Follow-up

- Un rilievo della challenge e' stato smontato e non diventa lavoro: **tornare
  indietro non costa un secondo rebuild**. `tools/build-graph.sh` conserva il grafo
  che era in uso e cancella solo i piu' vecchi; il rollback e' rifare il symlink
  `corrente` e ricreare i container.

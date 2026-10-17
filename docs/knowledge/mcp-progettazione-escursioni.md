# Progettazione escursioni via MCP

## Come funziona oggi

- **MCP server nel gateway** (`gateway/src/mcp/`), wrapper di `/v1`: tool
  `route` (risposta compatta per LLM: totali, tappe, sentieri per ref, avvisi
  compreso il fuori-area con l'area dichiarata, campione di geometria) e
  `poi_nearby` (tabella `poi` di `ways.sqlite`). Le istruzioni d'uso viaggiano
  dentro il server: disciplina anti-invenzione («ogni numero viene dai tool»)
  e contenuti dei luoghi lasciati agli strumenti web del client — dal server
  escono solo identificatori (`wikipedia`/`wikidata`), mai contenuti.
- **Deliverable firmati**: la risposta di `route` porta `/g/?t=<blob>`
  (punti + profilo + data stamp, firma HMAC con `WM_LINK_KEY`): la rotta
  `/g/` espande verso la preview (banner se il data stamp non coincide più
  coi dati correnti) e serve il GPX generato dal server (`/g/gpx`). Un link
  alterato o troncato dà un errore esplicito, mai un giro diverso.
- **Due transport, stesso codice dei tool**: stdio in locale (`npm run mcp`,
  registrato in Claude Code); rotta `/mcp` streamable HTTP stateless con
  token in query string (`WM_MCP_TOKEN`), interruttore `WM_MCP_ENABLED` e
  rate limit. Segreti solo in variabili d'ambiente (`.env` gitignorato).
- **POI dal pre-passo**: `prepare/enrich.py` estrae in `ways.sqlite` la
  tabella `poi` (nodi con nome: cime, valichi, sorgenti e acqua, rifugi e
  ripari, belvedere, abitati). Fail-soft: se l'estrazione fallisce il build
  resta valido, senza tabella.
- `tools/log-check.sh` copre anche `/g/` e `/mcp`: oltre alle coordinate,
  nei log non devono finire né il blob firmato né il token.
- Accettazione: `gateway/scripts/mcp-check.mjs` (deterministico, confronto
  con `/v1` vivo, mai un atteso congelato) + checklist manuale
  `docs/howto/collaudo-connector-mcp.md`.

## Perché così

- **L'inference la paga l'utente** col suo abbonamento, collegando il
  connector al proprio account: la via opposta — un'app che consuma
  l'abbonamento AI dell'utente — è vietata da Anthropic (feb 2026) e su
  domanda per i partner su OpenAI.
- **GPX e link generati dal server**: il modello non trascrive mai
  coordinate. Lo spike del 2026-10-17 (nel design) ha misurato il perché:
  senza tool, più di 2 ore di errore su una tappa (16-18 km / 6-6,5 h
  stimati contro 22,8 km / 8,6 h del motore); con i tool, numeri
  riproducibili e ref tutti esistenti.
- **Stateless con blob autodescrittivo** («l'URL fa da ID», idea di
  Giuseppe): niente stato sul server, e alterazioni o dati invecchiati
  falliscono in modo rumoroso (firma e data stamp).

## Come ci siamo arrivati

- **Sintesi e traduzione dei contenuti a runtime per l'app di massa**
  (scartato): l'app dei visitatori serve contenuto offline e revisionato;
  osmfeatures resta per quel flusso, l'MCP lo affianca solo nella
  progettazione.
- **Chat dentro l'app Webmapp sull'abbonamento AI dell'utente** (scartato):
  vedi la prima voce di «Perché così».
- **Skill installabile come veicolo della conoscenza** (scartato): attrito
  di installazione su N piattaforme; le istruzioni viaggiano nel server MCP
  e si aggiornano lato server.
- **Tool wiki passthrough lato server** (scartato): il client AI ha già i
  suoi strumenti web; un passthrough sarebbe il primo passo per ricostruire
  la manutenzione di contenuti che si voleva eliminare.

Design: [docs/superpowers/specs/2026-10-17-mcp-progettazione-escursioni-design.md](../superpowers/specs/2026-10-17-mcp-progettazione-escursioni-design.md)
· Requisiti e piano: [docs/features/mcp-progettazione-escursioni/](../features/mcp-progettazione-escursioni/)

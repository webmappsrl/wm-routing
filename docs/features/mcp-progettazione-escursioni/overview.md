# Servizio MCP di progettazione escursioni — prima versione

Design di riferimento (approvato il 2026-10-17):
[docs/superpowers/specs/2026-10-17-mcp-progettazione-escursioni-design.md](../../superpowers/specs/2026-10-17-mcp-progettazione-escursioni-design.md)

## Cosa cambia

wm-routing guadagna un MCP server in Node, dentro `gateway/`, che espone a
Claude (e in prospettiva ad altri chatbot) i dati del servizio come tool:
calcolo percorso coi profili esistenti, dettagli per tratto, POI vicini con
identificatori wiki, e per ogni percorso calcolato il **link della preview già
composto dal server** — chi lo apre vede il giro ricostruito sulla mappa e
scarica il GPX dal bottone che la pagina già ha. Due modi di esecuzione con lo
stesso codice dei tool: **stdio in locale** (Claude Desktop/Code lo lanciano
da soli) e **rotta streamable HTTP sul gateway online** (`routing.maphub.it`),
protetta da un token segreto nella URL, con rate limiting e un interruttore
per spegnerla quando non serve.

## Perché

I chatbot pianificano escursioni in modo plausibile ma inventato (numeri di
sentiero, tempi, dislivelli); wm-routing ha ciò che gli manca: routing vero,
quote DEM, difficoltà, tempi DIN 33466, osmid. Lo spike del 2026-10-17
(documentato nel design) ha confermato la differenza: con i tool ogni numero è
riproducibile e ogni ref esiste; senza, errori fino a +2 ore su una tappa.
L'inference la paga l'utente col suo abbonamento (connector collegato da lui);
wm-routing è ancora un prototipo, quindi la rotta online si può esporre e
spegnere liberamente.

## Requisiti

- [ ] MCP server in Node (`gateway/src/mcp/`), SDK MCP ufficiale, stesso
  codice dei tool per i due transport: avvio **stdio** e rotta
  **streamable HTTP** sul gateway.
- [ ] Tool `route`: punti e profilo in ingresso (profili e limiti dello shard
  dedicato), risposta **compatta pensata per un LLM** — totali (km, dislivelli,
  ore DIN), tappe cumulate, sentieri aggregati per ref con difficoltà, avvisi
  (punti fuori sentiero, quota sconosciuta, neve, suggerimento di profilo),
  campione di geometria con quote — mai la risposta grezza di `/v1`. Tra gli
  avvisi anche il **fuori area**: punti fuori dal rettangolo coperto danno
  una risposta esplicita con l'area dichiarata (da `/v1/version`), e le
  istruzioni del server dicono all'AI di riferirlo, non di arrangiarsi.
- [ ] Nella risposta di `route`: un **link corto firmato** composto dal
  server (`/g/?t=<blob>`), mai ricostruito dall'AI. Il blob codifica punti,
  profilo e data stamp dei dati, firmato (HMAC) con una chiave del server:
  un link alterato o troncato dal modello dà una **pagina di errore
  esplicita**, mai un giro plausibile ma diverso. Aprendo il link il server
  lo espande verso la preview col giro ricostruito; se il data stamp non
  coincide più coi dati correnti (grafo rigenerato), **banner**: «i dati sono
  cambiati da quando hai progettato questo giro: ricontrolla i numeri».
- [ ] Sullo stesso link, il **download GPX generato dal server** (`.gpx` dal
  blob firmato): il file lo produce il motore, mai trascritto dal modello.
  Il bottone GPX della preview resta come comodità. Il blob viaggia in query
  string, che per regola del repo non finisce nei log.
- [ ] Istruzioni d'uso **dentro il server MCP** (server instructions e
  descrizioni dei tool): come combinare i tool, disciplina anti-invenzione
  («ogni numero viene dai tool; i sentieri citati sono quelli restituiti; se
  un dato manca, dirlo»), rimando ai tool web del client per i contenuti wiki.
- [ ] Rotta online: token segreto nella URL come unico accesso (fase di beta
  personale: un token, account di Giuseppe), rate limiting, interruttore per
  disattivarla (config/deploy), niente CORS aperto. **I segreti — token di
  accesso e chiave di firma dei link — vivono solo in variabili d'ambiente**
  (environment del compose o file fuori dal repo); nella config versionata
  restano solo interruttore, profili ammessi e rate.
- [ ] La rotta MCP entra nel **logging esistente**: una riga per richiesta
  (tool chiamato, esito, millisecondi — mai coordinate), via
  `gateway/src/log.js`, così abuso e malfunzionamento si vedono come per
  `/v1`.
- [ ] Tool `poi_nearby` (ultimo blocco): POI vicino a un punto o al percorso
  con nome, tipo, quota, osmid e tag `wikipedia`/`wikidata` come **soli
  identificatori** — nessun contenuto wiki passa dal server.
- [ ] Tabella `poi` in `ways.sqlite` (o file sorella), estratta dal PBF in
  `prepare/enrich.py` accanto alla tabella `ways`: nome, tipo, quota, osmid,
  tag wiki. Rebuild del grafo della cella per rigenerarla.
- [ ] `horse_rating` e il suo significato riciclato **filtrati** da ogni tool.
- [ ] Nessuna coordinata nei log: la rotta MCP e ogni log nuovo passano da
  `gateway/src/log.js`; `tools/log-check.sh` copre anche la rotta nuova.
- [ ] Test di accettazione su **due livelli**. (1) **Deterministico, in CI**:
  chiama i tool MCP direttamente (senza AI) con la richiesta campione
  «profilo libero da San Giuliano Terme al Monte Serra» e confronta la
  risposta compatta con ciò che `/v1` dà in quel momento — stesso grafo,
  niente atteso congelato che invecchia: verifica il wrapper, non i dati.
  Più i test su firma del link, pagina d'errore e banner del data stamp.
  (2) **Collaudo col connector reale** (da claude.ai): checklist manuale
  periodica — tool giusti chiamati, numeri in chat coincidenti con l'output
  dei tool, link che apre il giro, GPX scaricato. La prosa dell'AI resta
  fuori dal confronto.

## Rischi

Dalla challenge del 2026-10-17, con le mitigazioni decise:

- **Corruzione silenziosa del deliverable** (trascrizione del link da parte
  del modello; grafo rigenerato tra pianificazione e download): mitigato dal
  link corto firmato con data stamp — alterazione → errore esplicito, dati
  cambiati → banner. È il motivo per cui l'endpoint GPX firmato è rientrato
  in scope.
- **Test di accettazione non deterministico**: mitigato dai due livelli
  (CI senza AI contro `/v1` vivo; connector reale come checklist manuale).
- **Segreti nella config versionata**: mitigato — token e chiave di firma
  solo in variabili d'ambiente.
- **Guasti/abusi sulla rotta nuova colpiscono il gateway condiviso**: il
  processo condiviso si accetta in questa fase (prototipo, interruttore); la
  rotta entra nel logging esistente, e il piano include la configurazione di
  Caddy per il transport streamable HTTP (timeout, buffering). La
  separazione dei processi si riconsidera alla fase «sul server».
- **Coordinate nella query string**: coperto dalla regola esistente (niente
  query string nei log); `tools/log-check.sh` va esteso alle rotte nuove —
  requisito dedicato.
- **Token nella URL della rotta online**: chi vede la URL ha l'accesso. In
  beta personale è accettato (un token, revocabile); mitigato da rate
  limiting e interruttore. La gestione per più persone è fuori scope.
- **Risposta dei tool troppo lunga**: compattazione come requisito, col
  formato dello spike come riferimento.
- **Nota di trasparenza** (non requisito): le posizioni dell'utente
  transitano comunque dal provider AI che lui stesso ha scelto; va detto
  nella documentazione quando si andrà verso il B2C.

## Out of scope

- Sportello/registrazione utenti, token multipli, OAuth, ChatGPT: fase «sul
  server» del design, dopo i test interni.
- PDF dell'itinerario.
- Tool «percorso lungo il sentiero X» (route per ref/nome di relazione OSM).
- Statistiche e telemetria sulle richieste.
- Caricamento di un GPX nella preview (drag & drop): era il visualizzatore di
  verifica quando il GPX nasceva lato server; col GPX che esce dalla preview
  stessa non serve più in questa versione.
- Contenuti wiki lato server (fetch, riassunto, traduzione, cache).

## Moduli toccati

Tutto nel repo wm-routing (nessun submodule):

- `gateway/src/mcp/` — nuovo: server MCP, tool, istruzioni, avvio stdio.
- `gateway/src/server.js` — aggancio della rotta streamable HTTP (come
  `/preview`), dietro token e interruttore, e della rotta `/g/` (espansione
  del link firmato verso la preview, download GPX dal blob).
- `preview/preview.js` — banner «dati cambiati» quando il data stamp del
  link non coincide con `/v1/version`.
- `gateway/config/` — shard o sezione di config dedicata all'MCP (profili
  ammessi, rate, token, interruttore).
- `prepare/enrich.py` — estrazione della tabella `poi` accanto a `ways`.
- `gateway/src/details.js` / lettura di `ways.sqlite` — lettura della tabella
  `poi` per il tool `poi_nearby`.
- `tools/log-check.sh` — copertura della rotta nuova.
- `gateway/test/` — test dei tool (formato compatto, filtri, link preview) e
  del controllo di accettazione.

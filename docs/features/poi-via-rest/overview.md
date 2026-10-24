# I POI via REST, e lo shard per un chiamante che non è un LLM

## Cosa cambia

Il gateway espone i **punti di interesse vicini** anche come rotta HTTP, non solo come
tool MCP, e guadagna uno **shard** per un consumatore nuovo. Due cose piccole, nessuna
delle quali tocca il comportamento del server MCP.

Oggi i POI esistono solo attraverso l'MCP: `makePoiNearbyTool` (`gateway/src/mcp/poi.js`)
legge la tabella laterale `poi` di `ways.sqlite` ed è registrata come tool in
`gateway/src/mcp/server.js:218`. Non c'è nessuna rotta HTTP che restituisca quei dati, e
chi non parla MCP non può averli. Dopo questo lavoro c'è.

## Perché

Nasce **Walkiria**, un'applicazione web e mobile per progettare itinerari. Non è un
secondo client MCP: il suo «cervello» è il proprio codice, che chiama i servizi quando
decide lui. Un modello generativo conduce il dialogo con chi progetta, un modello a
giudizi tipizzati (Jev) ricava i parametri dal contesto, e il codice chiama `route` e
compone. Non c'è nessun agente autonomo a cui far scoprire dei tool, quindi MCP non
serve — serve un'interfaccia per il codice.

Il confine è netto e conviene tenerlo tale: **`wm-routing` con il suo MCP è un prodotto,
Walkiria è un altro.** I link firmati, il documento autosufficiente e il metodo scritto
nelle descrizioni dei tool risolvono i vincoli di un modello che lavora dentro la chat di
qualcun altro, senza un server proprio. Walkiria quei vincoli non li ha: ha un backend,
una sessione e un database, quindi **i deliverable se li genera**. Da `wm-routing` prende
solo ciò che non può rifare — **il calcolo e i dati**.

Di calcolo ce n'è già: `/v1/:shard/route` è pubblico e parametrico. Mancano i dati.

## Requisiti

- [ ] **Una rotta per i POI vicini**, registrata come gli altri handler di `createApp`
      (`handlers: {route, rejoin, poi}`), con gli stessi parametri e gli stessi limiti del
      tool: punto `[lon, lat]`, raggio fra 1 e 2.000 metri con default 500, al massimo 20
      risultati, ordinati per distanza
- [ ] **La risposta è quella del tool**: `name`, `kind`, `ele`, `lonLat`, `osmId`,
      `distanzaM`, più `wikipedia` e `wikidata` quando ci sono. Stessi identificatori,
      nessun contenuto: chi chiama recupera i testi per conto suo
- [ ] **La rotta riusa la connessione al database già aperta** (`deps.waysDb`) invece di
      aprirne una nuova a ogni richiesta, come fa oggi `makePoiNearbyTool`. Per un tool
      chiamato qualche volta per conversazione va bene così; per una rotta interrogata a
      ogni variante proposta, no
- [ ] **Nessuna logica duplicata**: la ricerca resta quella di `mcp/poi.js`, la rotta è un
      involucro. Se un giorno cambia il criterio di ricerca, cambia per entrambi i canali
- [ ] **La rotta non viene pubblicata da Caddy.** La raggiunge il backend di Walkiria
      sulla rete interna della macchina; da internet non esiste. È il motivo per cui non
      serve inventare un'autenticazione per `/v1`, che oggi non ne ha
- [ ] **Uno shard `walkiria` in `gateway/config/shards.json`**: gli stessi sei profili,
      `maxPoints: 25`, `origins: []` perché il chiamante non è un browser, e un `rate`
      come quello di `mcp`. Senza, Walkiria eredita il default di **dieci** punti
      (`route.js:16`, applicato in `route.js:222`), che è quello dello shard `webmapp`
- [ ] **Non si riusa lo shard `mcp`**: un picco di Walkiria consumerebbe i gettoni del
      connettore delle chat, e viceversa. Sono due prodotti, con due profili di consumo
- [ ] **Il server MCP non cambia comportamento.** Stessi tool, stesse descrizioni, stesse
      risposte: `gateway/scripts/mcp-check.mjs` e `scheda-check.mjs` passano come prima
- [ ] **`npm test` passa**, e la rotta nuova ha i suoi test: punto non valido, raggio
      fuori intervallo, grafo senza la tabella `poi` (che oggi non è un errore ma una
      risposta dichiarata), nessun risultato nel raggio

## Rischi

- **Si tocca `app.js`, che è il percorso condiviso con lo shard `mcp` in produzione.** Il
  connettore delle chat passa di lì. *Mitigazione:* la rotta nuova si aggiunge come
  handler, senza modificare quelli esistenti né il middleware di shard; gli script di
  accettazione dell'MCP girano prima del merge.
- **Una rotta interna che per errore finisce pubblicata espone l'intero database dei
  POI.** Non è un dato sensibile — viene da OpenStreetMap — ma è una superficie che
  nessuno ha chiesto. *Mitigazione:* la configurazione di Caddy fa parte di questo lavoro,
  non è un passaggio successivo, e va verificata dopo il deploy con una chiamata da fuori.
- **Il contratto della risposta non è formalizzato.** Gli schemi zod del gateway sono solo
  `inputSchema`: le risposte sono oggetti costruiti a mano (`JSON.stringify(out)`,
  `mcp/server.js:199`). Chi consuma la rotta si scrive i tipi a mano e li tiene allineati
  a mano. *Mitigazione:* nessuna in questo ciclo — vedi «Out of scope».
- **Il nome `poi` è terminologia di comunità, non un tag OSM.** Sotto ci sono `natural`,
  `tourism`, `amenity` e `place`. Chi legge la rotta potrebbe aspettarsi un'altra cosa.
  *Mitigazione:* la documentazione della rotta elenca i `kind` che il database contiene
  oggi (`prepare/enrich.py:38-62`) e dichiara che l'elenco è destinato a crescere.

## Out of scope

- **Rotte REST per i deliverable** (`giro_finale`, `documento_giro`). Non servono:
  Walkiria genera i propri. Quelle funzioni restano dell'MCP, che è il contesto per cui
  sono nate.
- **Schemi zod di risposta e un OpenAPI generato.** Renderebbero il contratto
  verificabile a macchina invece che a mano, ed è la cosa giusta da fare prima o poi — ma
  è un lavoro a sé, che tocca tutte le risposte del gateway e non solo questa rotta.
- **Autenticazione su `/v1`.** Non serve finché i consumatori sono la webapp, il
  connettore e un backend sulla stessa macchina. Servirà il giorno in cui Walkiria
  traslocherà altrove: allora sarà un lavoro suo, con un token vero.
- **Allargare le categorie di POI** oltre le dieci escursionistiche di oggi. È una
  direzione dichiarata — tutto OpenStreetMap, più categorie prodotte da Webmapp, anche
  riconosciute da codice — ma è un cantiere della pipeline, con la sua qualità da
  misurare, e va fatto **insieme** a un criterio di rilevanza: più categorie senza un
  filtro peggiorano l'esperienza di chi consuma invece di migliorarla.
- **Riscrivere `docs/knowledge/mcp-progettazione-escursioni.md`.** Il metodo a fasi resta
  una proprietà dell'MCP e non cambia: Walkiria non lo eredita, perché il suo gate è un
  bottone e la sua macchina a stati è codice. Basta una riga che segnali il secondo
  consumatore dei POI.

## Moduli toccati

| Percorso | Cosa |
|---|---|
| `gateway/src/app.js` | registrazione della rotta POI fra gli handler |
| `gateway/src/mcp/poi.js` | estrazione della ricerca perché accetti una connessione già aperta; nessun cambiamento di comportamento |
| `gateway/config/shards.json` | lo shard `walkiria` |
| test del gateway | la rotta nuova |
| configurazione Caddy (fuori dal repo) | la rotta non si pubblica |
| `docs/knowledge/mcp-progettazione-escursioni.md` | una riga: i POI hanno un secondo consumatore |

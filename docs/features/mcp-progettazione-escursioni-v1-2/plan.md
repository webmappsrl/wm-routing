# v1.2 del servizio MCP di progettazione escursioni — piano

> **Per chi esegue:** usare `superpowers:subagent-driven-development` (consigliato)
> o `superpowers:executing-plans`. Gli step hanno le checkbox per il tracciamento.

**Obiettivo:** un tool che riceve dall'assistente solo il suo testo e
restituisce il documento del giro già completo — fatti nostri, racconto suo —
come file HTML autosufficiente che l'utente apre e stampa.

**Architettura:** la costruzione dei dati della scheda diventa un modulo puro
condiviso fra la rotta `/g/scheda.json` e il nuovo tool. Lo scheletro HTML
acquista slot dichiarati e un blocco di dati inline; `scheda.js` legge i dati
inline se ci sono, altrimenti continua a chiederli alla rotta come oggi. Il
tool rende il Markdown dell'assistente con un renderer di sottoinsieme scritto
in casa (nessuna dipendenza nuova nel gateway), lo scrive negli slot e
restituisce l'HTML completo.

**Stack:** gateway Node 20 / express 5 / vitest + supertest; pagina statica in
`preview/` senza bundler; nessuna dipendenza npm nuova nel gateway.

**Overview:** [overview.md](overview.md) · base
[v1.1](../mcp-progettazione-escursioni-v1-1/) e
[pagina di conoscenza](../../knowledge/mcp-progettazione-escursioni.md).

## Vincoli globali

- **Nessuna dipendenza npm nuova nel gateway.** Vale per il renderer Markdown
  e per tutto il resto. Nella pagina, le librerie da CDN sono ammesse con la
  stessa postura già in uso (OpenLayers, ol-mapbox-style).
- **Il modello non fornisce mai dati**: al tool passano solo il blob firmato e
  il proprio testo. Nome, quota, posizione, numeri e geometria li risolve il
  server. Gli osmId che l'assistente cita devono già stare nel blob.
- **Niente coordinate, blob, token, osmId né testo dell'assistente nei log**
  (`gateway/src/log.js`, `tools/log-check.sh`).
- **Il testo attraversa il server, non ci resta**: nessuna scrittura su disco,
  nessuna cache, nessuna struttura che sopravviva alla richiesta.
- **Nessuna regressione sulla v1.1**: i link `/g/scheda` già consegnati
  continuano a funzionare identici, senza slot e senza blocco inline.
- Commit: `feat(mcp-progettazione-escursioni): …`. I commit nel piano sono
  **istruzioni testuali**, non azioni da eseguire in automatico.

## Review Focus

Classi di input che l'overview implica e che nessun test di task esercita
naturalmente:

1. **Markdown ostile** — `<script>`, `<img onerror>`, `javascript:` in un link,
   HTML grezzo: deve uscire come testo visibile, mai come elemento attivo.
2. **Markdown gigantesco** — 200 KB di testo in un argomento: il tool deve
   rifiutare con un errore chiaro, non produrre un file che non si apre.
3. **osmId nel testo che non sta nel blob** — l'assistente descrive un luogo
   che non ha scelto: va ignorato con un conteggio, non scritto nel documento.
4. **Markdown vuoto o solo spazi** — gli slot non devono comparire vuoti con il
   loro titolo.
5. **Documento senza nessuna foto** — l'impaginazione deve reggere, e con una
   foto sola non deve restare mezza pagina bianca.

---

## File

- Crea `gateway/src/mcp/dati-scheda.js` — costruzione del payload della scheda,
  pura, condivisa fra rotta e tool.
- Crea `gateway/src/mcp/markdown.js` — renderer di sottoinsieme Markdown → HTML
  sicuro per costruzione.
- Crea `gateway/src/mcp/documento.js` — composizione dello scheletro con gli
  slot riempiti; restituisce l'HTML completo.
- Modifica `gateway/src/mcp/g-route.js` — usa `dati-scheda.js`.
- Modifica `gateway/src/mcp/server.js` — il tool `documento_giro` e le
  istruzioni della fase di export.
- Modifica `preview/scheda.html`, `scheda.js`, `scheda.css` — dati inline,
  slot, foto, fonti, GPX con QR, stampa in bianco e nero.
- Modifica `gateway/scripts/mcp-check.mjs`, `scheda-check.mjs`,
  `tools/log-check.sh`, `docs/howto/collaudo-connector-mcp.md`.

---

### Task 1: il payload della scheda diventa un modulo condiviso

**File:**
- Crea: `gateway/src/mcp/dati-scheda.js`
- Modifica: `gateway/src/mcp/g-route.js:111-130`
- Test: `gateway/test/mcp-dati-scheda.test.js`

**Interfacce:**
- Produce: `datiScheda({route, blob, resolvePoi, dataStamp}) -> object` — lo
  stesso oggetto che oggi `/g/scheda.json` serializza (`profilo`, `distanzaKm`,
  `salitaM`, `discesaM`, `oreDIN33466`, `quotaMinMaxM`, `tappe`, `sentieri`,
  `geometry`, `stamp`, `stampCorrente`, `avvertenza`, `poi`, `poiMancanti`,
  `poiNonDisponibili`). `route` è il risultato di `compute`. Sincrona.
- Produce: `resolveSchedaPoi` si sposta qui da `g-route.js`.

- [ ] **Step 1: test che fallisce** — `gateway/test/mcp-dati-scheda.test.js`:
  dato un risultato di `compute` di fixture e un blob con due POI, `datiScheda`
  restituisce i campi attesi; con `resolvePoi` che lancia, `poiNonDisponibili`
  è `true` e `poi` è vuoto; con `dataStamp` che lancia, `stampCorrente` è
  `null` e non propaga l'eccezione.
- [ ] **Step 2: eseguire il test** — `cd gateway && npm test -- mcp-dati-scheda`.
  Atteso: FAIL, modulo inesistente.
- [ ] **Step 3: implementare `dati-scheda.js`** spostandoci la logica che oggi
  sta dentro il handler di `/g/scheda.json`, senza cambiarne il comportamento.
- [ ] **Step 4: riscrivere il handler** di `/g/scheda.json` perché chiami
  `datiScheda` e serializzi il risultato. Niente altro cambia.
- [ ] **Step 5: eseguire la suite** — `cd gateway && npm test`. Atteso: tutti i
  test esistenti di `g-route` passano invariati.
- [ ] **Step 6: commit** — `feat(mcp-progettazione-escursioni): payload della
  scheda in un modulo condiviso`.

---

### Task 2: la scheda legge i dati inline

**File:**
- Modifica: `preview/scheda.html`, `preview/scheda.js:150-158`
- Test: `gateway/scripts/scheda-check.mjs` (esteso alla fine del task)

**Interfacce:**
- Consuma: l'oggetto di `datiScheda` (Task 1).
- Produce: lo scheletro contiene
  `<script type="application/json" id="dati-giro"></script>`; se il suo
  contenuto non è vuoto, `scheda.js` lo usa e **non** chiama `/g/scheda.json`.

- [ ] **Step 1: aggiungere il blocco** vuoto in `scheda.html`, prima degli
  script.
- [ ] **Step 2: cambiare `main()`** in `scheda.js`: legge il testo del blocco,
  se è una stringa non vuota fa `JSON.parse` e rende; altrimenti fa il fetch di
  oggi. Un `JSON.parse` fallito mostra lo stesso messaggio d'errore del fetch
  fallito — il file è alterato, non si indovina.
- [ ] **Step 3: provare a mano** aprendo la scheda con il gateway vivo
  (`/g/scheda?t=…`): il blocco è vuoto, il fetch avviene, la pagina è identica
  a prima.
- [ ] **Step 4: commit** — `feat(mcp-progettazione-escursioni): la scheda
  accetta i dati inline`.

---

### Task 3: renderer Markdown sicuro per costruzione

**File:**
- Crea: `gateway/src/mcp/markdown.js`
- Test: `gateway/test/mcp-markdown.test.js`

**Interfacce:**
- Produce: `renderMarkdown(testo) -> string` (HTML) e
  `MAX_MARKDOWN = 20000` (caratteri per singolo slot).

Sottoinsieme sostenuto, e nient'altro: paragrafi, `## ` e `### ` (mai `#`, il
titolo è nostro), elenchi `- ` e `1. `, `**grassetto**`, `*corsivo*`,
`` `codice` ``, link `[testo](https://…)` limitati agli schemi `http` e
`https`. Tutto il resto resta testo.

**Sicuro per costruzione:** si fa **prima** l'escaping completo di `& < > " '`
su tutto il testo, **poi** si applicano i pattern del sottoinsieme sull'output
già escapato. Non esiste nessun percorso in cui un carattere dell'autore
diventi markup: l'HTML grezzo in ingresso esce visibile come testo.

- [ ] **Step 1: test che fallisce** — oltre al sottoinsieme, i casi ostili:
  `<script>alert(1)</script>` esce come testo; `<img src=x onerror=alert(1)>`
  esce come testo; `[x](javascript:alert(1))` non produce un `href`;
  `[x](https://a.it)` lo produce; `**a** <b>c</b>` dà `<strong>a</strong>` e
  `&lt;b&gt;c&lt;/b&gt;`; testo vuoto o di soli spazi dà stringa vuota.
- [ ] **Step 2: eseguire** — `cd gateway && npm test -- mcp-markdown`. FAIL.
- [ ] **Step 3: implementare** `markdown.js` nell'ordine escaping → pattern.
- [ ] **Step 4: eseguire** — PASS.
- [ ] **Step 5: provare a invertire l'ordine** (pattern prima dell'escaping) e
  verificare che i test ostili diventino rossi: se restano verdi, non provano
  quello che dicono. Ripristinare.
- [ ] **Step 6: commit** — `feat(mcp-progettazione-escursioni): renderer
  Markdown sicuro per costruzione`.

---

### Task 4: gli slot nello scheletro e la loro resa

**File:**
- Modifica: `preview/scheda.html`, `preview/scheda.js`, `preview/scheda.css`

**Interfacce:**
- Consuma: `renderMarkdown` (Task 3), applicato lato server prima
  dell'inserimento nel file.
- Produce: nei dati inline (Task 2) compare il campo facoltativo
  `racconto: {introduzione, luoghi: {<osmId>: html}, consigli, fonti: [{titolo,
  url}]}`, già in HTML reso. `scheda.js` lo inserisce così com'è; se il campo
  manca, la pagina è quella di oggi.

- [ ] **Step 1: slot nella resa** — `render()` scrive, quando il campo c'è:
  l'introduzione dopo l'intestazione e prima della mappa; la descrizione di
  ogni luogo nella sua riga della tabella dei luoghi (sotto nome e nota); i
  consigli in una sezione propria prima del piede.
- [ ] **Step 2: uno slot vuoto non compare** — niente titolo di sezione senza
  contenuto. Verificato aprendo la scheda senza `racconto`: identica a oggi.
- [ ] **Step 3: la distinzione si vede in bianco e nero** — `scheda.css`:
  la parte dell'assistente ha un riquadro con bordo e un'etichetta di
  intestazione, non un colore di sfondo. Verificato stampando in scala di
  grigi.
- [ ] **Step 4: l'avviso riguarda solo quella parte** — una riga nell'etichetta
  del riquadro: scritta dall'assistente dell'utente a partire dalla
  conversazione, da rileggere prima di partire; i numeri e il percorso restano
  garantiti da noi. Non nel piede, dove si prenderebbe tutto il foglio.
- [ ] **Step 5: commit** — `feat(mcp-progettazione-escursioni): slot del
  racconto nella scheda`.

---

### Task 5: il tool `documento_giro`

**File:**
- Crea: `gateway/src/mcp/documento.js`
- Modifica: `gateway/src/mcp/server.js`
- Test: `gateway/test/mcp-documento.test.js`

**Interfacce:**
- Consuma: `datiScheda` (Task 1), `renderMarkdown`/`MAX_MARKDOWN` (Task 3), gli
  slot (Task 4), `decodeLink`, `compute`.
- Produce: `makeDocumentoTool({gatewayUrl, publicUrl, linkKey, fetchFn,
  waysDbPath, previewDir}) -> (args) => risultato`, registrato come tool
  `documento_giro`.

**Argomenti del tool:** `t` (il blob firmato restituito da `giro_finale`),
`introduzione` (Markdown), `luoghi` (array di `{osmId, testo}`), `consigli`
(Markdown), `fonti` (array di `{titolo, url}`). Nessuna coordinata, nessun
nome, nessun numero.

**Cosa fa:** decodifica e valida il blob → `compute` → `datiScheda` → rende il
Markdown di ogni slot → compone l'HTML con i dati inline e il racconto →
restituisce `{documento: "<!doctype html>…", nomeFile: "giro-<km>km.html",
luoghiIgnorati: <n>}`.

- [ ] **Step 1: test che fallisce** — con un blob valido e due luoghi, il
  risultato è HTML che contiene i numeri di `datiScheda` e il testo reso; con
  un blob alterato, `firma_non_valida`; con un osmId non presente nel blob,
  quel testo non compare e `luoghiIgnorati` è 1; con uno slot oltre
  `MAX_MARKDOWN`, errore `testo_troppo_lungo` che dice quale slot e di quanto;
  con `<script>` nel testo, l'HTML non contiene quel tag aperto.
- [ ] **Step 2: eseguire** — `cd gateway && npm test -- mcp-documento`. FAIL.
- [ ] **Step 3: implementare `documento.js`.** Lo scheletro si legge una volta
  alla costruzione, non a ogni chiamata. Il blocco dei dati inline si scrive
  con `JSON.stringify` più la sostituzione di `<` con `<`, altrimenti un
  `</script>` dentro un testo chiude il blocco.
- [ ] **Step 3-bis: il documento è autosufficiente davvero.** Aperto da
  `file://`, un modulo ES caricato con `src` verso un'altra origine non parte
  (CORS), e `/preview/scheda.css` non si trova. Quindi il tool **incorpora nel
  file**: `scheda.css`, e `scheda.js` con i moduli che importa
  (`profilo-disegno.js`, `profilo-scala.js`) risolti in un unico blocco
  `<script type="module">`. Restano da CDN solo OpenLayers e lo stile della
  mappa, che senza rete semplicemente non si vedono. Verificato aprendo il file
  con `file://` in Playwright: la pagina rende, profilo compreso.
- [ ] **Step 4: registrare il tool** in `makeMcpServer` con la descrizione che
  dice cosa accetta e cosa no, dentro `logged('documento_giro', …)` come gli
  altri.
- [ ] **Step 5: niente resta sul server** — verificato leggendo il modulo: nessun
  `writeFile`, nessuna variabile a vita lunga che tenga il testo.
- [ ] **Step 6: eseguire la suite** — `cd gateway && npm test`. Verde.
- [ ] **Step 7: commit** — `feat(mcp-progettazione-escursioni): tool che
  compone il documento del giro`.

---

### Task 6: foto dei luoghi e attribuzione

**File:**
- Modifica: `preview/scheda.js`, `preview/scheda.css`

**Interfacce:**
- Consuma: i campi `wikipedia`/`wikidata` dei POI, che `datiScheda` deve
  portare nell'oggetto `poi` (aggiunta a Task 1, campo in più, nessun cambio di
  forma).

- [ ] **Step 1: portare gli identificatori** nei dati dei POI (`dati-scheda.js`
  e la sua query), con il test corrispondente.
- [ ] **Step 2: la pagina chiede la miniatura** a Wikipedia per i POI che hanno
  l'identificatore, come già fa la preview. Niente identificatore, niente
  richiesta: il luogo resta con nome, quota e descrizione.
- [ ] **Step 3: attribuzione** sotto ogni immagine — autore e licenza, presi
  dalla stessa risposta. Senza quei campi, l'immagine non si mostra: una foto
  CC-BY-SA senza attribuzione su un documento che distribuiamo non si fa.
- [ ] **Step 4: miniature, non originali** — si chiede la dimensione ridotta;
  verificato che il file del documento resti sotto il mezzo megabyte con tre
  foto.
- [ ] **Step 5: l'impaginazione regge con zero e con una foto** — verificato a
  mano su due documenti veri.
- [ ] **Step 6: commit** — `feat(mcp-progettazione-escursioni): foto dei luoghi
  con attribuzione`.

---

### Task 7: GPX dal documento, con QR, e sezione delle fonti

**File:**
- Modifica: `preview/scheda.html`, `preview/scheda.js`, `preview/scheda.css`

- [ ] **Step 1: il link al GPX** nel documento, composto dal blob che i dati
  inline già portano (campo nuovo `linkGpx` in `datiScheda`).
- [ ] **Step 2: il codice QR** dello stesso indirizzo, disegnato nella pagina
  da una libreria da CDN (stessa postura di OpenLayers). Verificato che il
  codice si legga davvero da un telefono su un foglio stampato: il blob è
  lungo, se non si legge il QR non serve e si toglie, lasciando l'indirizzo per
  esteso.
- [ ] **Step 3: la sezione delle fonti**, divisa: le nostre (OpenStreetMap con
  la data dei dati, i tempi secondo DIN 33466) e quelle dell'assistente (il
  campo `fonti`, come elenco). **Scritte per la carta**: titolo e indirizzo per
  esteso, mai una parola sottolineata.
- [ ] **Step 4: l'avvertenza sul GPX** — il file si ricalcola sul grafo del
  momento: una riga dice che se il documento è vecchio di giorni, i due
  potrebbero non coincidere.
- [ ] **Step 5: commit** — `feat(mcp-progettazione-escursioni): GPX, QR e fonti
  nel documento`.

---

### Task 8: le istruzioni del server

**File:**
- Modifica: `gateway/src/mcp/server.js` (`INSTRUCTIONS`)
- Test: `gateway/test/mcp-server.test.js`

- [ ] **Step 1: la fase di export diventa due passi** — `giro_finale` per i
  link del giro, poi `documento_giro` per il documento da portarsi dietro. Le
  istruzioni dicono che il documento è il deliverable da consegnare, e che il
  testo lo scrive l'assistente senza ripetere i numeri: ci pensa il documento.
- [ ] **Step 2: una riga su cosa scrivere negli slot** — introduzione del giro,
  una descrizione per luogo, consigli su orari, acqua e attrezzatura; le fonti
  nel campo loro, non nella prosa.
- [ ] **Step 3: il gate resta prima dell'export** e non si tocca.
- [ ] **Step 4: quando il profilo lo sceglie l'assistente, lo dichiara** — una
  riga che chiude il rilievo della prova dal vivo (scelse `prudente` da
  «cammina poco» senza dirlo).
- [ ] **Step 5: test** — le istruzioni nominano `documento_giro` e lo collocano
  dopo il gate; il test esistente sul gate resta verde.
- [ ] **Step 6: commit** — `feat(mcp-progettazione-escursioni): metodo con il
  documento finale`.

---

### Task 9: accettazione

**File:**
- Modifica: `gateway/scripts/mcp-check.mjs`, `gateway/scripts/scheda-check.mjs`,
  `tools/log-check.sh`, `docs/howto/collaudo-connector-mcp.md`

- [ ] **Step 1: `mcp-check`** — `documento_giro` con due luoghi restituisce un
  HTML che contiene i numeri di `/v1` vivo (confrontati, non congelati); un
  testo ostile non produce tag attivi; lo stesso blob senza racconto produce un
  documento che è la scheda di oggi.
- [ ] **Step 2: `scheda-check`** — apre il documento prodotto dal tool con
  Playwright **da file locale** (è lì che vivrà), e verifica: i numeri, il
  profilo disegnato, il racconto nel suo riquadro, le fonti divise, il link al
  GPX. Il controllo deve fallire se il racconto non compare: provato togliendo
  lo slot.
- [ ] **Step 3: `log-check`** — una chiamata a `documento_giro` con un testo
  inconfondibile, e l'asserzione che quel testo non compaia nei log. Come per
  le note, con un blob **dentro** l'area, così il percorso di successo gira
  davvero.
- [ ] **Step 4: checklist manuale** in `collaudo-connector-mcp.md` — il
  documento di una conversazione vera è leggibile; le foto compaiono dove
  esistono; la distinzione fra fatti e racconto si vede su un foglio stampato
  in bianco e nero; il QR si legge dal telefono.
- [ ] **Step 5: eseguire tutto** — `npm test`, `mcp-check`, `scheda-check`,
  `log-check`. Tutto verde.
- [ ] **Step 6: commit** — `feat(mcp-progettazione-escursioni): accettazione
  del documento del giro`.

---

### Task 10: pagina di conoscenza

**File:**
- Modifica: `docs/knowledge/mcp-progettazione-escursioni.md`

- [ ] **Step 1: aggiornare «Come funziona oggi»** col quarto tool e col
  documento autosufficiente.
- [ ] **Step 2: aggiungere a «Perché così»** la ragione della chiamata sola (il
  documento nasce completo o non nasce) e quella del testo che attraversa senza
  restare.
- [ ] **Step 3: aggiungere a «Come ci siamo arrivati»** ciò che è stato provato
  e scartato in questo ciclo: lo store sul server con scadenza, il fragment, la
  ricerca per posizione su Wikimedia Commons (con le misure).
- [ ] **Step 4: passare da `wm-context-guard`** prima di scrivere, e correggere
  quello che segnala.
- [ ] **Step 5: commit** — `docs(mcp-progettazione-escursioni): conoscenza
  della v1.2`.

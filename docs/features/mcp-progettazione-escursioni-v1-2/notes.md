# Notes — v1.2 del servizio MCP di progettazione escursioni

Esecuzione del 2026-10-18, 10 task con un subagente implementatore e un
revisore indipendente per ciascuno, più una review finale sull'intero branch.
Suite da 200 a 267 test; `mcp-check` da 25 a 39 controlli; due script di
accettazione nuovi (`foto-check.mjs`, e la parte del documento in
`scheda-check.mjs`).

## La decisione che ha cambiato il ciclo

L'overview partiva con uno **store sul server**: il tool avrebbe conservato il
testo descrittivo e la scheda l'avrebbe letto da lì. La challenge ha mostrato
che quasi tutti i rischi del ciclo discendevano da quella rottura della
statelessness, e il committente ha riportato la cosa alla forma che aveva in
mente dall'inizio: **il tool riceve il testo, compone il documento e lo
restituisce** — il testo *attraversa* il server, non ci *resta*.

Da lì cadono da sole tre cose: la retention, il documento che si svuota alla
scadenza, e l'ordine fra due chiamate (con una sola chiamata il documento
nasce completo o non nasce).

## Difetti trovati dalle review

- **Il testo del modello poteva rompere il documento** (Task 5, Critico).
  `String.prototype.replace(stringa, stringa)` interpreta `$&` e `$'` nella
  *sostituzione*: un `$&` scritto dall'assistente rimetteva nel file il tag
  `<script id="dati-giro">` trovato, moltiplicando i blocchi e rompendo il
  JSON. L'utente avrebbe salvato e stampato **una pagina di errore**, con il
  tool che rispondeva successo. Corretto col replacer come funzione.
- **La fase 7 era saltabile** (Task 8, Critico). La fase 6 diceva «Consegna i
  link» e la 7 «Poi chiama `documento_giro`»: un modello letterale consegnava i
  link e chiudeva il turno. Dimostrato cambiando la frase in «Consegna i link e
  fermati»: tutti i 33 test restavano verdi. Ora la fase 6 dice «Non rispondere
  all'utente qui» e la 7 «Subito dopo, nella stessa risposta».
- **L'avviso spariva proprio quando il documento era pieno** (review finale).
  La riga che marca il racconto compariva sulla sezione dei luoghi *solo se
  mancava l'introduzione* — cioè quasi mai. La pagina con i consigli su acqua e
  rifornimenti era l'unica senza avviso.
- **`fonti[].url` era l'unico slot senza tetto** (review finale): 30 url da
  50.000 caratteri davano un documento di 1,5 MB, che torna tutto nel contesto
  del modello e si stampa come pagine di base64.
- **Il link del GPX poteva essere quello locale** (Task 7). Nessun test
  distingueva `publicUrl` da `gatewayUrl`, e in produzione `gatewayUrl` è
  `127.0.0.1:8991`: il foglio avrebbe mostrato un indirizzo locale e un QR
  verso localhost.

## Controlli che non controllavano

Il tema ricorrente del ciclo. Ogni volta trovati con il mutation testing:

- **L'escape del blocco dei dati** (Task 5): togliendo l'intera difesa la suite
  restava verde, perché il test passava `<script>` dentro l'introduzione, dove
  il renderer Markdown l'aveva già neutralizzato. L'unico input che arriva
  crudo sono le **fonti**, e non erano coperte.
- **`foto-check.mjs`** (Task 6) dichiarava garanzie che non aveva: il controllo
  «contattiamo solo Wikimedia» abortiva le richieste verso gli altri domini
  *prima* di registrarle, e la «nessuna ricerca per posizione» non era
  sorvegliata affatto. Una `fetch` verso un host ostile e una chiamata
  `list=geosearch` passavano entrambe col controllo verde.
- **Il profilo, il racconto e i numeri del documento** (Task 9): si poteva
  togliere il disegno del profilo, il riquadro dei consigli, la riga di
  attribuzione, o scambiare fra loro Distanza e Salita, con `scheda-check`
  verde. Lo scambio Salita/Discesa passava anche perché il giro di prova è ad
  anello, dove i due valori coincidono: aggiunto un giro lineare.
- **Il confronto del GPX** era tautologico (trovato dall'implementatore stesso):
  confrontava il file con il blob contenuto nel link del documento invece che
  con quello passato al tool.

## Decisioni prese durante l'esecuzione

- **Un tool solo, non due.** Due chiamate avrebbero permesso di consegnare il
  link prima di riempire gli slot: esattamente il degrado silenzioso per cui
  era stato scartato il fragment.
- **Renderer Markdown scritto in casa**, sicuro per costruzione (escaping di
  tutto, *poi* i pattern sull'output già escapato), invece di una libreria:
  regola del repo sulle dipendenze. Passato da una review avversariale che ha
  provato a forgiare i segnaposto interni, a uscire da `href`, a far passare
  `javascript:` in sette travestimenti: niente è uscito.
- **Il documento incorpora CSS e JS**, perché da `file://` un modulo ES con
  `src` esterno non parte (CORS) e il foglio di stile non si risolve. Nella
  review finale è stata incorporata anche la libreria del QR: restano da CDN
  solo OpenLayers e lo stile della mappa, che senza rete non possono funzionare
  per natura.
- **Foto nella colonna del luogo, non in quella della nota** (trovato
  guardando il PDF): una foto di Wikipedia dentro la colonna del racconto si
  legge come scritta dall'assistente.
- **Niente attribuzione, niente immagine**: le miniature sono CC-BY-SA.
- **Il bottone Stampa aspetta le immagini in volo**, altrimenti chi apre il
  file e stampa subito ottiene un foglio senza foto.
- **Soglia del QR a 101 moduli** (circa 5 POI): misurato decodificando il PDF
  rasterizzato a 100, 150 e 300 dpi. Oltre, resta l'indirizzo per esteso.
- **La soglia del test sui tempi è relativa**, non fissa in millisecondi: una
  soglia fissa diventa rossa su una macchina carica anche col codice giusto.

## Aperto, da decidere con il dev

- **Il documento su disco non è firmato.** Chi lo riceve da un amico non può
  verificare che i numeri non siano stati cambiati a mano, mentre il link
  online quella garanzia ce l'ha.
- **Su un giro con molti luoghi il GPX non è raggiungibile dalla carta**: il QR
  non entra e l'indirizzo occupa venti righe di base64. Accorciarlo vorrebbe
  dire uno short link con stato sul server.
- **La foto che Wikipedia restituisce non è sempre una foto**: su Monte Verruca
  è una carta di posizione, con autore e licenza regolari, quindi passa il
  filtro.
- **Il QR su carta vera non è stato provato con un telefono**: la misura è su
  PDF rasterizzato. È in checklist, dichiarato come non fatto.
- **Il marcatore della partenza su un giro non ad anello** è verificato per
  posizione e stile, non per visibilità sul foglio.

## Follow-up

- Il documento torna nel contesto del modello (~43 KB per chiamata, di cui ~40
  KB di CSS e JS nostri uguali ogni volta).
- Tre validazioni di URL diverse, nate in tre task (`documento.js`,
  `scheda.js`, `markdown.js`): la regola non sta in un posto solo.
- `preview/scheda.js` è passata da ~150 a ~390 righe e tiene insieme
  rendering, QR, Wikipedia e mappa: candidata a due moduli.
- Lessico non uniforme: `poiMancanti`/`poiNonDisponibili` della v1.1 accanto a
  `luoghiIgnorati`/`luoghiSenzaTesto`/`luoghiDuplicati` della v1.2.
- Nel file salvato il banner «i dati sono cambiati» è congelato per
  costruzione: non potrà mai accendersi. Resta l'avvertenza sul GPX.
- Nessun `integrity` sugli script da CDN: era già così per la pagina online, ma
  ora è un file che l'utente tiene su disco per mesi.
- Il profilo è verificato per presenza di pixel del tracciato, non per forma.
- `documento_giro` accetta qualsiasi blob valido, compreso il `linkPreview` di
  `route`: un modello può produrre il documento prima della conferma. Vale già
  per `linkGpx` dalla v1.1; una vera correzione richiederebbe di marcare il
  blob come confermato.

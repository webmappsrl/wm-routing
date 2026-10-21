# Servizio MCP di progettazione escursioni — v1.2: il documento si riempie

Base: la v1.1 (docs/features/mcp-progettazione-escursioni-v1-1/, committata il
2026-10-18) e la pagina di conoscenza
[docs/knowledge/mcp-progettazione-escursioni.md](../../knowledge/mcp-progettazione-escursioni.md).

## Cosa cambia

La scheda stampabile smette di essere un elenco di fatti e diventa il
documento del giro. Lo **scheletro resta del server** — mappa, profilo,
numeri, tappe, sentieri, luoghi, impaginazione — e acquista dei **posti
vuoti**; un tool li riempie con la parte descrittiva scritta dall'assistente:
introduzione, racconto dei luoghi, consigli su orari, acqua e attrezzatura.

L'assistente passa **Markdown**, non HTML: compone come vuole dentro i posti
che gli spettano, ma non può toccare lo scheletro né iniettare contenuto
eseguibile. Le **foto** dei luoghi le cerca la pagina da sé. Il **GPX** si
scarica dal documento. E il documento **dice quale parte è di chi**.

## Perché

La v1.1 è corretta e fredda. Alla prima prova vera il giudizio è stato
immediato: «la parte dove l'IA poteva fare molto ha fatto quasi niente, i PDF
sono molto freddi, di IA non c'è nulla». È vero, e ha una causa sola: la
scheda si costruisce **solo** dal blob firmato, dove per scelta ci sono
soltanto fatti. Tutto ciò che l'assistente produce nella conversazione — il
racconto, i consigli, il filo dell'itinerario — non ha nessun canale per
arrivare nel documento che l'utente si porta dietro.

Quella scelta nasceva da un vincolo reale (il testo lungo non sta in una
query string) ma ha svuotato il deliverable proprio della cosa che il
prodotto promette: che l'AI dell'utente racconti i luoghi.

Il principio che risolve la tensione è emerso in conversazione, dal
committente: **la firma attesta i dati, non la parte generativa.** I fatti
devono essere verificati e firmati; il racconto no — se qualcuno lo altera
resta una storia discutibile, non un sentiero sbagliato. Due parti, due
livelli di fiducia, un documento solo.

## Requisiti

- [ ] **Lo scheletro prevede i posti vuoti.** La pagina della scheda ha slot
  dichiarati per: introduzione del giro, una descrizione per ogni waypoint,
  note per tappa, consigli finali. Senza contenuto, gli slot semplicemente
  non compaiono e il documento resta quello di oggi (nessuna regressione).
- [ ] **Un tool riempie gli slot e restituisce il documento finito.**
  L'assistente passa **solo il proprio testo**, in **Markdown**, come
  argomenti della chiamata (introduzione, una descrizione per osmId,
  consigli, fonti) insieme al blob firmato del giro. Il tool prende lo
  scheletro, ci scrive dentro il testo negli slot e **restituisce l'HTML
  completo**, che l'assistente consegna all'utente come file da aprire e
  stampare.
  - **Il testo attraversa il server, non ci resta**: il tool è una funzione
    pura — entra il testo, esce il documento, non si salva niente. Il
    servizio resta senza stato come oggi: nessuna scadenza, nessun documento
    che si svuota, nessun indirizzo che punta a un foglio vuoto.
  - **I numeri non passano mai dal modello**: lo scheletro coi fatti non gli
    viene mai consegnato, quindi non c'è nulla da ritrascrivere e nulla da
    alterare. È la stessa ragione per cui i POI viaggiano come osmId.
  - **Una sola chiamata, nessun ordine da rispettare**: o si riceve il
    documento completo, o non si riceve niente. Due chiamate separate —
    prima il link, poi il contenuto — avrebbero permesso di consegnare un
    documento ancora vuoto senza nessun avviso, lo stesso degrado silenzioso
    per cui è stato scartato il fragment.
  - Perché Markdown e non HTML libero: libertà di composizione
    all'assistente, controllo dello stile e della sicurezza al server. Un
    HTML libero potrebbe rompere l'impaginazione e iniettare contenuto
    eseguibile su un dominio nostro.
  - Perché non nel **fragment** dell'URL: il testo non passerebbe mai da noi,
    ma a comporre quell'indirizzo dovrebbe essere il modello, che si
    troverebbe a scrivere a mano una stringa codificata di migliaia di
    caratteri — la stessa classe di trascrizione meccanica che tutto il
    servizio esiste per eliminare, con degrado silenzioso se sbaglia.
- [ ] **Il Markdown si rende in modo sicuro**: nessun HTML grezzo passa, i
  link sono consentiti ma non gli script, e il risultato finisce dentro il
  layout del documento, non al posto suo.
- [ ] **I fatti non cambiano**: percorso, numeri, tappe, sentieri e POI
  restano quelli calcolati e firmati come in v1.1. Il contenuto descrittivo
  non può contraddirli né sostituirli.
- [ ] **Il documento dichiara chi ha scritto cosa**: la parte descrittiva è
  marcata come scritta dall'assistente, con un avviso pacato — non è
  invenzione libera, è il riassunto di una conversazione a cui l'utente ha
  partecipato, ma va riletta prima di partire. **L'avviso riguarda solo
  quella parte**: un disclaimer sull'intero foglio si prenderebbe anche i
  chilometri e i dislivelli, che sono esattamente ciò che il servizio
  garantisce.
- [ ] **Foto dei luoghi, cercate dalla pagina, solo per identificatore.**
  Dove il POI porta un `wikipedia`/`wikidata` (dal tag OSM, via la tabella
  `poi`), la pagina chiede riassunto e miniatura a Wikipedia, come già fa la
  preview. Dove l'identificatore manca, il punto resta con nome, quota e
  descrizione: il documento si assottiglia, non si rompe. **Nessuna immagine
  passa dai nostri server.**
  - **La ricerca per posizione su Wikimedia Commons è stata provata e
    scartata.** Misurato su tre punti del giro di Calci: sul Monte Serra —
    l'unico dei tre con il tag wiki — non restituisce **nulla** entro 300 m,
    quindi le due strade non si sommano; sul Monte Verruca restituisce cinque
    immagini di cui una è una fortezza della Garfagnana geolocalizzata male;
    sulla fontana Scarpa d'Orlando restituisce la foto di un cartello
    stradale. Per qualche immagine in più metteremmo materiale sbagliato o
    inutile in un documento che per il resto garantiamo dato per dato. Si
    riapre dopo aver visto documenti veri, se le foto mancheranno davvero.
- [ ] **Sezione delle fonti**, divisa come il resto del documento:
  - **nostre**: OpenStreetMap per percorso e punti, con la data dei dati;
    i tempi secondo DIN 33466;
  - **dell'assistente**: le pagine wiki da cui vengono i racconti, il
    servizio meteo consultato, le altre letture. Arrivano col contenuto
    descrittivo, in un campo loro, così si rendono come elenco e non
    annegate nella prosa.
  - **Scritte per la carta**: su un foglio stampato un link non si clicca,
    quindi titolo e indirizzo per esteso, non parole sottolineate.
- [ ] **Il GPX si scarica dal documento**, così l'utente lo carica dove
  vuole; sul foglio stampato il link non si clicca, quindi serve anche un
  codice QR.
- [ ] **Accettazione**: il controllo deterministico verifica che gli slot
  vuoti non alterino il documento, che il Markdown venga reso senza HTML
  grezzo né script, che un contenuto ostile non diventi eseguibile, e che il
  GPX scaricabile dal documento sia quello del giro. Più la checklist
  manuale: il documento prodotto da una conversazione vera è leggibile, le
  foto compaiono dove esistono, e la distinzione fra fatti e racconto si vede.

## Rischi

- **La parte descrittiva contiene consigli di sicurezza** — dove c'è acqua,
  quanto dura una tappa, quando girarsi indietro — e quelli non sono
  «una storia discutibile». Il principio «la firma attesta i dati, non la
  prosa» regge sulla responsabilità editoriale, non sulle conseguenze: se
  l'assistente scrive che alla sella c'è una fonte e la fonte è secca, il
  danno è reale anche se il chilometraggio è esatto. L'avviso che marca
  quella parte deve dirlo in modo utile, non assolverci.
- **Il documento si stampa in bianco e nero**: la distinzione visiva fra
  fatti e racconto non può affidarsi al colore. Serve una separazione che
  sopravviva a una stampante laser — riquadro, titolo, posizione.
- **Attribuzione delle immagini**: le miniature di Wikipedia sono quasi
  sempre CC-BY-SA, che richiede autore e licenza accanto all'immagine. Va
  previsto nel layout, non aggiunto dopo.
- **Il GPX si ricalcola sul grafo del momento**: la scheda stampata il
  mercoledì e il GPX scaricato la domenica potrebbero non coincidere se nel
  frattempo è cambiato il grafo. Il banner della data dei dati c'è già, ma
  qui i due deliverable si separano nel tempo per la prima volta.
- **Il Markdown è contenuto scritto da un modello** reso sul nostro dominio:
  la resa va fatta con una libreria che non emetta HTML grezzo, e va provata
  con contenuti ostili, come è già stato fatto per le note.
- **Poche foto**: con le sole foto da identificatore, su un giro tipico se ne
  avranno due o tre — i paesi e le cime famose. È una scelta consapevole
  (vedi i requisiti): meglio tre immagini giuste che otto a caso. Il layout
  deve reggere bene anche con nessuna.
- **Il peso del documento**: le immagini vanno prese in miniatura, non a
  piena risoluzione.
- **Le fonti dell'assistente sono dichiarate da lui**: nessuno verifica che
  abbia letto davvero quelle pagine. Fa parte della stessa natura della
  parte descrittiva, ed è coperto dall'avviso che la marca come sua.

## Out of scope

- Il tool dei **punti d'interrogazione del meteo** (calcolati dalla nostra
  geometria e dai tempi DIN): resta rimandato, questo ciclo è sul documento.
- PDF generato da una libreria lato server: il PDF continua a uscire dal
  browser.
- Mappa statica renderizzata dal server.
- Modifica del documento da parte dell'utente dopo la generazione.
- Archiviazione del testo per riuso (il corpus georeferenziato): escluso in
  v1.1 per coerenza architetturale, e resta escluso — qui il testo si
  conserva solo per servire quel documento, non per diventare un patrimonio.
- Sportello, OAuth, ChatGPT: fase «sul server» del design v1.

## Moduli toccati

Tutto nel repo wm-routing (feature custom, nessun submodule):

- `preview/scheda.html`, `scheda.js`, `scheda.css` — gli slot e la loro resa.
- `gateway/src/mcp/server.js` — il tool che riceve il contenuto descrittivo
  e restituisce il documento finito.
- `gateway/src/mcp/g-route.js` — lo scheletro della scheda diventa
  componibile anche fuori dalla rotta `/g/scheda`, così lo stesso codice
  serve la pagina e alimenta il tool.
- `gateway/scripts/scheda-check.mjs`, `mcp-check.mjs`,
  `docs/howto/collaudo-connector-mcp.md` — accettazione estesa.

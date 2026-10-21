# Servizio MCP di progettazione escursioni (B2C) — design

Data: 2026-10-17. Stato: bozza in attesa di approvazione di Giuseppe.
Nato dal brainstorming del 17 ottobre e dallo spike descritto in fondo.

## Intento e perché

Webmapp offre a chiunque — B2C, servizio di Webmapp e non dei singoli
clienti — la progettazione di escursioni tramite l'AI che l'utente già usa e
paga (Claude, ChatGPT o altro). L'app/portale Webmapp fa solo da **sportello**:
registrazione, token personale, link del connector MCP e istruzioni di
collegamento. La pianificazione vive nel chatbot dell'utente, qualche giorno
prima dell'uscita, online; i deliverable sono **GPX e PDF** da portare in
montagna, dove non serve niente di online.

Perché ha senso: i chatbot pianificano già viaggi, ma su una rete
sentieristica **inventano** — numeri di sentiero, tempi, dislivelli,
difficoltà. wm-routing ha esattamente ciò che gli manca: routing vero su
GraphHopper, quote dal DEM, difficoltà SAC/CAI dai dati, tempi DIN 33466,
osmid per risalire alle wiki. Il valore del servizio è «calcolo + ground truth
che l'AI non può fingere», non i prompt.

Perché questa architettura: l'inference la paga l'utente, legalmente — è lui a
collegare un connector dentro il proprio account. La via opposta (l'app che
consuma l'abbonamento AI dell'utente) è vietata da Anthropic (feb 2026) e
contingentata da OpenAI (partner su domanda), quindi non è percorribile in
modo neutrale rispetto al provider.

## Obiettivi

1. **MCP server remoto** (HTTP) nel gateway Node di wm-routing, rotta dedicata
   accanto a `/v1`, dietro lo stesso Caddy.
2. **Wrapper, non logica nuova**: i tool traducono chiamate MCP in chiamate
   alle API esistenti. Se durante lo sviluppo serve logica vera, si mette in
   `/v1`, dove serve a tutti i client.
3. **Tool della prima versione**:
   - calcolo percorso con i profili esistenti (prudente…alpinista, mtb),
     multi-punto, con tappe cumulate;
   - dettagli del percorso per tratto: ref, difficoltà, fondo, avvisi
     (punti fuori sentiero, quota di sentieri sconosciuti, neve, profilo
     suggerito);
   - POI vicino a un punto o al percorso: restituisce nome, osmid e, quando
     c'è nei dati, il tag `wikipedia`/`wikidata` come **identificatore e
     basta**. Cercare, leggere, riassumere e tradurre le wiki è lavoro
     dell'AI dell'utente, con i suoi strumenti: il nostro valore è dire
     «questo POI è quella pagina», non portarne il contenuto (fonte dati:
     vedi «Aperto»);
   - **export GPX generato dal server** dalla risposta del motore — mai
     trascritto dal modello: un GPX così non può contenere un sentiero
     inventato, per costruzione.
4. **Risposte compatte pensate per un LLM**: geometria campionata, sentieri
   aggregati per ref, totali e avvisi. La risposta grezza di `/v1` (geometria
   completa) non deve mai arrivare al modello.
5. **Conoscenza d'uso dentro il server** (istruzioni del server, descrizioni
   dei tool, prompt MCP): come combinare i tool, i limiti, e la disciplina
   anti-invenzione — «ogni numero viene dai tool; i sentieri citati sono
   quelli restituiti; se un dato manca, si dice». Si aggiorna lato server
   senza che l'utente faccia nulla, e vale identica su tutte le piattaforme.
6. **Auth con token personale** emesso dallo sportello Webmapp; rate limiting
   per token; revoca. *(Fase «sul server»: nella prima versione locale non
   c'è auth — vedi Decisioni.)*
7. **Onboarding a prova di scimmia**: la parte più delicata del prodotto non è
   la tecnica ma il collegamento del connector. Pagina/app che genera il token
   e guida passo passo su Claude e ChatGPT, con deep link dove la piattaforma
   lo permette. *(Fase «sul server».)*

## Non-obiettivi

- **Non sostituisce osmfeatures** per l'app di massa: qui sintesi e traduzione
  le fa l'AI dell'utente al momento della progettazione, per quel giro.
- **Niente chat dentro l'app Webmapp** e niente inference pagata da Webmapp.
- **Niente skill da installare** come veicolo principale (al più un di più per
  power user, in seguito).
- **Niente statistiche o telemetria sulle richieste** nella prima versione.
  Se un domani si vorranno, si progettano come aggregazione (conteggi per
  zona a zoom basso, profilo, periodo), mai salvando richieste grezze: le
  posizioni restano dati personali anche senza nome.
- `map-core` non si tocca (regola del repo).

## Anti-obiettivi (se succede questo, il progetto è venuto male)

- Un MCP «grosso» che accumula logica propria: composizione di itinerari,
  cache di contenuti, template. È il segnale che si sta duplicando `/v1`.
- Numeri o sentieri nel GPX/PDF passati dalle mani del modello.
- Coordinate nei log della rotta nuova (vale la regola del gateway: ogni log
  passa da `gateway/src/log.js`, verificato da `tools/log-check.sh`).
- `horse_rating` o il suo significato riciclato esposti da un tool.
- Tool che scaricano, riassumono o traducono contenuti wiki o di altri siti
  lato server: quella parte la fa l'AI dell'utente. Noi consegnamo solo
  identificatori e dati nostri.
- Un onboarding che richiede più di un paio di minuti a un utente non tecnico
  con abbonamento AI.

## Vincoli

- Stessa macchina di wm-tiles, stessi dati; **wm-routing legge i dati di
  wm-tiles, mai il contrario** (nessun passo nella pipeline di wm-tiles).
- GraphHopper resta al commit fissato, **nessun codice Java nostro**.
- Sul Mac solo la cella di prova (Pisa); l'area intera sul server.
- I profili cambiano versione quando cambia il loro custom model (impronta in
  `gateway/config/profiles.json`).
- Copertura territoriale: quella dei dati di wm-tiles di oggi (area del grafo
  in produzione). Il servizio dichiara l'area coperta (`/v1/version` la
  espone già) e i tool devono dire chiaramente «fuori area» invece di tacere.

## Decisioni già prese (di Giuseppe, nel brainstorming)

- B2C: servizio offerto da Webmapp a chiunque, non white-label per i parchi.
- L'app/portale fa solo da sportello; l'esperienza vive nel chatbot
  dell'utente, con il suo abbonamento.
- L'MCP fa da wrapper di API esistenti.
- Deliverable GPX e PDF; progettazione online a casa, uso offline sul campo.
- L'AI va **costretta** a usare i dati offerti e a non inventare (istruzioni
  più, soprattutto, design dei tool: il livello forte è che i deliverable li
  genera il motore).
- **Prima versione in locale** (2026-10-17): si sviluppa e si testa sul Mac
  di Giuseppe, cella di Pisa, account suo. Niente sportello, niente token,
  niente deploy: sportello, auth e messa sul server si studiano dopo i test
  interni. Di conseguenza il collegamento di prova è **Claude in locale**
  (Claude Desktop / Claude Code parlano con MCP server locali; ChatGPT
  richiede un endpoint remoto e rientra quando il servizio sarà sul server).
- **Export GPX stateless via URL autodescrittivo** (idea di Giuseppe: «l'URL
  che genera il tragitto fa da ID»): la risposta del calcolo include un URL
  di export con la richiesta codificata (punti, profilo, data stamp dei
  dati) e un checksum firmato. All'export il server verifica il checksum,
  ricalcola (deterministico a parità di dati) e serializza il GPX. Se il
  modello altera o tronca l'URL, l'export fallisce con errore: mai un file
  silenziosamente diverso. Nessuno stato sul server; l'URL è cliccabile
  anche direttamente dall'utente. Le coordinate codificate nell'URL
  ricadono nella regola esistente «niente query string nei log», e
  `tools/log-check.sh` deve coprire la rotta nuova.

## Scelte del progettista (mie; contestabili)

- MCP dentro il gateway wm-routing, non servizio separato: riusa logging
  sicuro, rate limiting, deploy e Caddy esistenti.
- Conoscenza d'uso nel server invece che skill installabile (meno attrito,
  una sola copia da mantenere, vale per tutte le piattaforme).
- Prima versione senza PDF: il PDF è composizione di contenuti (prosa
  dell'AI + numeri del motore) e merita un passo suo; il GPX invece è
  indispensabile da subito perché è l'anti-allucinazione.
- Modello di test: harness di valutazione sul modello dello spike (stesse
  richieste con e senza tool, verifica dei ref contro l'estratto OSM,
  riproduzione dei numeri).

## Aperto / lasciato al builder

- **Protocollo MCP**: in locale stdio o streamable HTTP, a scelta del
  builder. Auth, OAuth e requisiti delle piattaforme per i connector remoti
  sono rimandati alla fase «sul server» (decisione del 2026-10-17), insieme
  allo sportello.
- **Sportello/account consumer**: rimandato a dopo i test interni (decisione
  del 2026-10-17). Quando si riapre: cosa esiste in casa Webmapp per
  registrare utenti B2C ed emettere/revocare token, e se il servizio è
  gratuito o a pagamento.
- **Fonte POI concreta.** Stato di fatto (da wm-tiles-13, 2026-10-17): i POI
  di wm-tiles vivono in PMTiles (layer `poi`, `mountain_peak`, `place` di
  osm.pmtiles; cime/valichi/sorgenti in osmpoi.pmtiles), ma i tag
  `wikipedia`/`wikidata` **non** stanno nelle tile: restano nel PBF.
  Un'API spaziale «vicino a» in wm-tiles non c'è (serve solo tile). Due strade:
  1. estrarre nel pre-passo di wm-routing (che il PBF lo legge già) una
     tabella laterale dei POI con nome, quota, osmid e tag wiki, sorella di
     `ways.sqlite` — coerente con l'obiettivo di non dipendere da
     osmfeatures e con «wm-routing legge i dati di wm-tiles»;
  2. in alternativa o come ripiego, leggere i PMTiles di wm-tiles per le
     tile z14 toccate dal percorso (osmfeatures.maphub.it esiste e ha i tag
     completi, ma appoggiarcisi ricreerebbe la dipendenza che questo
     progetto vuole evitare).
  La scelta e il formato sono del builder; l'intento di Giuseppe (bypassare
  osmfeatures) pesa a favore della strada 1.
- **Tool «percorso lungo il sentiero X»**: lo spike ha mostrato che l'AI trova
  sul web i *nomi* giusti (es. «anello di Vorno 122») ma può solo andare da
  punto a punto. Valutare un tool che accetta un ref/nome di relazione OSM e
  restituisce il percorso di quella relazione. Fase 2 se costa troppo.
- Limiti di rate per token, e cosa succede a chi li supera.
- Dove vive lo sportello (app esistente, pagina web nuova) e il flusso di
  onboarding per piattaforma.

## Lo spike che ha confermato la scommessa (2026-10-17)

Quattro richieste di pianificazione realistiche sulla cella di Pisa, stesso
modello con e senza accesso a `/v1` (via uno script usa-e-getta che compatta
la risposta). Risultato:

- **Senza dati**: o onesto ma inutilizzabile (nessun ref certo, proposte
  vaghe) o sbagliato dove conta — su una traversata di due giorni la prima
  tappa era stimata 16-18 km / 6-6,5 h contro i 22,8 km / 8,6 h del motore:
  più di due ore di errore su una tappa attorno a cui si prenota il
  pernottamento. Un sentiero citato («00») non esiste nei dati OSM della zona.
- **Con i dati**: ogni numero riprodotto esatto rifacendo le chiamate, tutti
  i ref citati (13 su 13 nel caso peggiore) esistenti nell'estratto OSM,
  esplorazione di varianti e scarto motivato di quelle fuori budget orario,
  giudizi onesti sui limiti («la cresta intera non ci sta in due giorni»).
- **Buco scoperto**: senza un tool POI l'itinerario è giusto nei numeri ma
  muto nel racconto (il caso «famiglie da Vorno»: giro perfetto su carrarecce
  senza nome). Da qui il tool POI tra gli obiettivi della prima versione.
- La disciplina «ogni numero viene dal tool» è stata rispettata da tutti gli
  agenti: è realistico pretenderla nelle istruzioni del server.

Il codice dello spike era usa-e-getta e non fa parte del progetto.

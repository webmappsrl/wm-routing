# Routing escursionistico: direttive per map-core

> **Non in sviluppo.** Queste sono direttive per il repo `map-core` (e per
> `wm-core`, dove serve l'interfaccia), da applicare quando partira' lo
> sviluppo lato app. Fino ad allora `map-core` non si modifica: il ciclo
> attuale riguarda solo il servizio (`overview.md` in questa cartella).
> I percorsi di file citati sotto sono relativi al repo `map-core`.

## Cosa cambia

L'app passa al nuovo servizio di routing **wm-routing** (overview in
`wm-routing/docs/features/routing-escursionistico/overview.md`) e ne usa i
parametri:

1. **Creazione della traccia UGC**: oltre ai punti, l'utente sceglie un
   **profilo** fra quelli che il servizio offre allo shard (per esempio
   `prudente`, `escursionista`, `esperto`, `alpinista`, `mtb`): nessun cursore
   o parametro libero. Oggi il profilo e'
   fisso a `hike` e non c'e' nessun parametro
   (`src/directives/custom-tracks.draw.directive.ts:167`).
2. **Rientro sulla traccia** (nuovo): mentre si segue una traccia, se ci si
   allontana oltre una soglia l'app chiede a wm-routing il percorso per
   tornarci e lo disegna. Senza rete mostra solo direzione e distanza dal punto
   piu' vicino della traccia.

## Perche'

Il routing di oggi non permette scelte all'utente e non aiuta chi esce dalla
traccia. I parametri arrivano dal servizio nuovo, ma senza un'interfaccia
nell'app restano inutilizzati.

## Requisiti

- [ ] Le versioni nuove chiamano wm-routing con la sua interfaccia, e leggono
      l'indirizzo da un **campo nuovo dello shard** (non `graphhopperHost`):
      se lo si cambiasse, anche le versioni vecchie, che leggono
      `graphhopperHost`, chiamerebbero wm-routing e si romperebbero. Le
      versioni vecchie restano sul GraphHopper di produzione
- [ ] La libreria `graphhopper-js-api-client` non serve piu': oggi le opzioni
      passate al suo costruttore (`vehicle`, `instructions`) non arrivano al
      server e l'URL esce `//route?key=undefined`
- [ ] Selettore del profilo nella creazione della traccia UGC, con i profili
      dello shard letti dal servizio
- [ ] Il profilo scelto si salva nelle proprieta' della traccia UGC, con la
      versione del profilo e la data dei dati restituite dal servizio: la
      traccia si ricalcola con lo stesso profilo nella versione attuale, e se
      il percorso cambia l'app lo dice ("il percorso e' stato aggiornato")
- [ ] Rilevamento dell'uscita dalla traccia, con una soglia di distanza e un
      ritardo per non scattare a ogni errore del GPS. Sotto il bosco il GPS
      sbaglia facilmente di 20-50 m: la soglia non puo' essere piu' stretta
- [ ] Percorso di rientro disegnato sulla mappa, distinto dalla traccia; il
      rientro punta a un punto piu' avanti sulla traccia, non alle spalle
- [ ] Il rientro si chiede solo dentro la fascia di distanza dalla traccia del
      servizio (sopra ~50 m, sotto 1 km a piedi e 2 km in MTB di default);
      fuori dalla fascia non si attiva
- [ ] Nella richiesta di rientro l'app manda il punto della traccia gia'
      raggiunto (metri percorsi): solo l'app lo sa, e senza quello le andate e
      ritorno sullo stesso sentiero sono ambigue
- [ ] Il primo tratto "fuori sentiero, X m" (in linea d'aria fino alla via piu'
      vicina) si disegna diverso dal resto del percorso di rientro
- [ ] **Isteresi e attesa le fa l'app**, perche' il servizio non conserva
      posizioni: il rientro si chiede quando ci si allontana oltre 50 m e si
      smette quando si torna sotto i 25 m; fra una richiesta e l'altra passa
      un tempo minimo (per esempio 60 s, o 100 m percorsi), cosi' l'errore del
      GPS sotto il bosco non fa partire una richiesta a ogni posizione
- [ ] Nella richiesta di rientro l'app manda il **verso** (`avanti` di serie,
      `indietro`, `piu' vicino`) e mostra, quando il servizio la propone,
      l'alternativa del ritorno al punto gia' raggiunto: decide la persona
- [ ] Se il servizio risponde "traccia non sui sentieri OSM" (map matching
      troppo lontano dalla traccia), l'app ripiega su direzione e distanza dal
      punto piu' vicino della traccia, come fuori rete
- [ ] Se il servizio non trova un percorso con il profilo scelto e suggerisce
      il profilo successivo, l'app lo propone all'utente senza cambiarlo da sola
- [ ] Se il servizio risponde `meta_non_raggiungibile` (un punto e' dove il
      profilo non arriva, es. una vetta su sentieri E con `prudente`), l'app
      indica quale punto (`punto`) e propone il profilo suggerito
- [ ] Se la risposta ha `fallbackLegs` (tratti calcolati con un profilo piu'
      permissivo di quello scelto, perche' con quello non si arriva), l'app li
      mostra distinti sulla mappa e lo dice prima di salvare la traccia: "fra il
      punto 8 e il 9 il percorso contiene tratti oltre il tuo profilo"
- [ ] Il profilo `libero` (qualsiasi via a piedi) si propone solo come scelta
      esplicita, con un avviso: comprende vie ferrate e ghiacciai
- [ ] Tappe dai punti di interesse della mappa: un tocco su un'icona delle tile
      (rifugio, cima, sorgente, valico: livelli `rifugi`, `osmpoi`,
      `mountain_peak`, `poi` di wm-tiles) usa le sue coordinate e il suo nome
      come tappa della traccia UGC, come fa la preview di wm-routing
      (`findPoi` in `preview/preview.js`)
- [ ] I `connectors` della risposta (dal punto messo dall'utente al punto
      agganciato alla via) si disegnano punteggiati, perche' il percorso del
      motore parte e arriva sulla via; nel rientro il primo segmento con
      `offTrail: true` e' il tratto in linea d'aria dalla persona alla via
- [ ] Se la risposta ha `offTrailPoints` (punti messi fuori dai sentieri,
      agganciati alla via piu' vicina), l'app lo dice all'utente con la
      distanza
- [ ] Il profilo di default e' quello prudente del servizio: i profili che
      aprono EEA e vie ferrate si scelgono esplicitamente
- [ ] I dettagli per tratto del servizio (difficolta', fondo, segnato,
      pendenza, guadi) si mostrano all'utente prima di salvare la traccia
- [ ] Durata, salita e discesa si prendono dal servizio; la formula
      `(distanza + salita x 10) / 3000` resta solo come ripiego quando il
      servizio non le fornisce (il GraphHopper di produzione)
- [ ] Fuori rete: direzione e distanza dal punto piu' vicino della traccia
- [ ] Ogni testo nuovo tradotto in tutte le lingue gia' presenti nel repo
- [ ] Verifica in OpenLayers, la libreria usata in produzione

## Funzioni da guida escursionistica (dalla preview, 16 ottobre 2026)

Aggiunte alla preview su richiesta del committente dopo il confronto con i
planner concorrenti (Komoot, AllTrails, Strava, GraphHopper Maps): ognuna e'
pensata per essere riprodotta nell'app. La preview e' il riferimento di
implementazione, in OpenLayers come l'app.

- [ ] **Tempi alle tappe**: la risposta di `/route` ha `waypoints`
      (`punto`, `index` nella geometria, `distanceM` e `timeH` DIN dalla
      partenza). L'app li mostra accanto a ogni tappa, come i cartelli dei
      sentieri. L'`index` serve anche a inserire un punto nella tappa giusta
      (sotto)
- [ ] **Difficolta' complessiva**: la massima dei tratti (ordine T, E, EE,
      EEA, via ferrata, ghiacciaio), mostrata come distintivo accanto al
      risultato (`overallDifficulty` nella preview)
- [ ] **Quota minima e massima e tratto piu' ripido** dai dettagli per tratto
      (`hikeStats`): il tratto piu' ripido e' cliccabile e si evidenzia
- [ ] **Segnavia**: ogni tratto ha `ref` (es. `"00;139"`, piu' segnavia
      separati da `;`). Si mostrano nei dettagli e in sintesi ("Segnavia: 00
      5,2 km, 139 1,1 km"). Richiede un grafo costruito con il pre-passo dal
      commit `e9c1d47` in poi: con una tabella laterale vecchia `ref` e' null
- [ ] **GPX**: si genera sul client dalla geometria (traccia con quote) e dai
      punti (wpt, col nome se la tappa viene da un POI): `toGpx()` della
      preview e' riusabile tale e quale
- [ ] **Inverti il giro / andata e ritorno**: operazioni sull'elenco dei punti
      (reverse; append dei punti in ordine inverso), il ricalcolo fa il resto
- [ ] **Punto inserito nella tappa giusta**: un punto aggiunto toccando il
      tracciato si inserisce fra i due punti del tratto a cui appartiene
      (`legOf(seg.from)` con `waypoints[].index`), non in coda
- [ ] **Trascinare il tracciato (solo mouse)**: `ol.interaction.Pointer`;
      `handleDownEvent` che risponde `true` su un tratto del percorso blocca il
      pan; al rilascio si inserisce il punto nel leg. Col dito non si fa: il
      gesto e' lo spostamento della mappa. Attenzione: il down catturato
      sopprime il `singleclick`, quindi anche il clic fermo si gestisce li'
- [ ] **Profilo altimetrico interattivo**: canvas con il tracciato colorato
      per criterio (stessi colori della mappa), alternative in grigio;
      al passaggio/tocco un segnaposto sulla mappa e la lettura
      "km · quota · pendenza · difficolta' · segnavia" (mappa pixel→distanza
      cumulata→indice della geometria)
- [ ] **Frecce del verso di percorrenza**: `ol.style.RegularShape` a 3 punte
      ruotata con `Math.atan2(dx, dy)` e `rotateWithView: true`, una ogni
      ~700 m lungo la geometria
- [ ] **Acqua e ripari lungo il giro**: sorgenti, fontane e rifugi entro 150 m
      dal tracciato, con il km. La preview legge le feature delle tile gia'
      caricate (`getFeaturesInExtent` sulle sorgenti vettoriali: elenco
      indicativo, dipende dalle tile in memoria); l'app, che conosce il
      servizio tile, puo' chiedere le tile z14 toccate dalla traccia e avere
      l'elenco completo. Il nome non si pretende: una fontana senza nome e'
      acqua lo stesso
- [ ] **Arrivo col buio** (solo app, non in preview): ora prevista d'arrivo =
      partenza + tempo DIN; se supera il tramonto (calcolabile sul client),
      avvisare prima di partire

## Rischi

- **Le versioni in uso non sono quelle dei cloni locali.** La webapp punta a
  `map-core` `86ebcec` e `wm-core` `0007580` (`origin/develop`, 16 ottobre
  2026): il lavoro parte dalle versioni puntate dalle app, non dal clone
  locale.
- **Batteria e GPS.** Il rilevamento dell'uscita gira mentre si cammina: un
  controllo troppo frequente consuma, uno troppo lento arriva tardi.
- **Chiamate ripetute.** Una posizione che oscilla attorno alla soglia non
  deve far partire una richiesta ogni pochi secondi.

## Out of scope

- Calcolo del percorso sul telefono senza rete
- Navigazione vocale e istruzioni svolta per svolta
- Anello che torna alla partenza e rifugi o sorgenti come tappe: il servizio
  potra' offrirli, l'interfaccia e' da un ciclo successivo

## Moduli toccati

Repo **map-core**:

- `src/directives/custom-tracks.draw.directive.ts` (richiesta e parametri)
- una direttiva nuova per il rientro sulla traccia
- file di traduzione

Repo **wm-core** (submodule delle app): il pannello di creazione della traccia
UGC con il selettore dei parametri, e l'attivazione del rientro mentre si
segue una traccia. File esatti da individuare nel piano.

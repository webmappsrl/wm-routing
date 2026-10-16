# Routing escursionistico

## Cosa cambia

Nasce **wm-routing**, un servizio di routing nuovo, costruito da zero, che
sostituisce il GraphHopper di produzione (`https://graphhopper.webmapp.it`).
Calcola i percorsi sugli **stessi dati da cui wm-tiles genera le tile**: lo
stesso PBF OpenStreetMap (aggiornato da `pipeline/aggiorna-osm.sh` di
wm-tiles) e lo stesso DEM (TINITALY sopra Copernicus GLO-30). Un tracciato
passa quindi sui sentieri che la mappa disegna, e il suo dislivello coincide
con l'ombreggiatura e le curve di livello.

Serve due casi d'uso dell'app:

1. **Creazione della traccia UGC** (gia' in uso): l'escursionista sceglie i
   punti e il profilo e riceve il tracciato.
2. **Rientro sulla traccia** (nuovo): se ci si allontana dalla traccia che si
   sta seguendo, il servizio calcola il percorso migliore per tornarci.
   Funziona online; senza rete l'app mostra solo direzione e distanza dal punto
   piu' vicino della traccia.

**Questo ciclo riguarda solo il servizio** (e la sua preview). La parte app
non si sviluppa ora: le direttive per `map-core` stanno in
[map-core.md](map-core.md) e si applicheranno quando partira' lo sviluppo
lato app.

**Nessun vincolo di compatibilita' con le app di oggi.** Le versioni attuali di
app e webapp continuano a chiamare il GraphHopper di produzione; le versioni
nuove chiameranno wm-routing. L'interfaccia del servizio si progetta quindi
per i casi d'uso, non per somigliare alla chiamata di oggi.

L'utente **sceglie un profilo**, non regola parametri. Ogni profilo e' un caso
d'uso preparato sul server, con preferenze e limiti gia' decisi. Proposta
iniziale, da tarare con la preview:

| Profilo | Per chi | Difficolta' (scala CAI) | Sentieri di difficolta' sconosciuta |
|---|---|---|---|
| `prudente` | famiglie, principianti | fino a T | esclusi (le forestali senza tag solo penalizzate) |
| `escursionista` | il default | fino a E | collegamenti corti come ultima risorsa; catene oltre 500 m escluse |
| `esperto` | chi va su EE | fino a EE | collegamenti corti come ultima risorsa; catene oltre 500 m penalizzate forte |
| `alpinista` | EEA e vie ferrate | tutto | ammessi |
| `mtb` | bici | `mtb:scale` limitato, niente scalini | come `escursionista` |

Dentro ogni profilo ci sono:

- **divieti** (limiti fisici o di sicurezza): la difficolta' massima secondo
  il modello descritto sotto, gli scalini e `mtb:scale` in MTB;
- **preferenze con un peso** (allungano poco il giro pur di rispettarle):
  rete CAI preferita, pendenze ripide evitate (piu' severo in `prudente`,
  assente in `alpinista`), asfalto e strade trafficate sfavoriti.

**Profili per shard.** Oltre ai profili di default, uno shard puo' avere i
suoi, costruiti partendo da quelli di default e cambiando solo le regole che
servono, sempre **sugli stessi dati OSM e sullo stesso grafo**. I sentieri
chiusi da un ente si esprimono come **aree** (poligoni stretti attorno al
sentiero, `areas` e `in_<id>` dei custom model), non come id delle vie: un
poligono resiste anche quando OSM spezza una via, e i custom model non hanno
un operatore "in lista" (`docs/core/custom-models.md` di GraphHopper). Il
poligono va tenuto stretto (10-15 m attorno al sentiero), perche' blocca anche
le altre vie che lo attraversano. Come per le tile, e' il server a decidere
quali profili uno shard puo' usare.

Accanto al servizio c'e' una **preview** web, sul modello di quella di
wm-tiles: mappa **OpenLayers** con le tile vettoriali di wm-tiles come sfondo,
e la scelta fra il routing di **produzione** e quello **nuovo**, ciascuno con i
suoi parametri, per confrontarli sugli stessi punti.

Tutto gira in **Docker** sulla stessa macchina di wm-tiles (`ssh wm-tiles`,
Hetzner CCX33, 8 vCPU, 32 GB).

## Perche'

Il GraphHopper di produzione e' poco configurabile e usa un DEM diverso da
quello delle tile. Verificato su `/info` (16 ottobre 2026): versione 7.0,
profili `hike`, `bike`, `foot`, e fra gli encoded values **non ci sono**
`sac_scale`, `mtb_scale`, `surface` ne' la pendenza, quindi la difficolta' del
sentiero non si puo' usare nel calcolo. Lato app il profilo e' fisso a `hike`
e l'utente sceglie solo i punti
(`map-core/src/directives/custom-tracks.draw.directive.ts:167`).

## Requisiti

### Dati e quote

- [ ] Repo `wm-routing`, servizio GraphHopper in container, con versione
      fissata. **GraphHopper dal ramo principale a un commit fissato**, non
      dalla 11.1 rilasciata: la sorgente di quote `pmtiles`, che legge
      Terrarium e Mapbox (`enum TerrainEncoding {MAPBOX, TERRARIUM}` in
      `PMTilesElevationProvider.java`), esiste solo li'. Si passa alla 12.0
      quando esce
- [ ] **Nessun codice Java nostro dentro GraphHopper.** La web app crea il
      motore con `new GraphHopper()` scritto nel codice
      (`GraphHopperManaged.java`): un parser nostro vorrebbe dire riscrivere il
      bundle. Tutto cio' che GraphHopper non sa leggere da solo si scrive nel
      PBF prima dell'import, in un **pre-passo** (vedi sotto)
- [ ] **Area del grafo = rettangolo del DEM** di wm-tiles, con un piccolo
      margine interno: `6.65,35.45,18.55,47.05`. Il DEM copre
      `6.6,35.4,18.6,47.1`, mentre l'OSM delle tile copre
      `4.39,35.37,22.11,48.06` (`wm-tiles/pipeline/build-italia.sh:42-43`):
      fuori dal DEM GraphHopper non ha quota (`NaN`,
      `PMTilesElevationProvider.java:230`). Il ritaglio conserva le vie intere
      al bordo (strategia `complete_ways` o `smart`, non `simple`), altrimenti
      le relazioni escursionistiche a cavallo del bordo perdono pezzi. Restano
      dentro Monte Bianco, Marittime, Monte Rosa, Ticino, Slovenia e Istria; si
      perdono Provenza interna, Tirolo del nord e Slavonia. Fuori dall'Italia
      il dislivello viene da Copernicus a 30 m (limite noto)
- [ ] **Controllo delle quote**: la costruzione del grafo fallisce se un nodo
      resta senza quota
- [ ] Il dislivello viene dal DEM di wm-tiles, raccolto in un **PMTiles a un
      solo livello, z13** (circa 19 m per pixel a 45°N), con
      `graph.elevation.pmtiles.zoom: 13` scritto esplicitamente: se manca,
      GraphHopper usa z11 (`Math.min(reader.header.maxZoom, 11)`,
      `PMTilesElevationProvider.java:168`), circa 76 m per pixel, e il
      dettaglio si perde in silenzio. Perche' z13 e non z14: GraphHopper legge
      la quota solo nei punti delle vie, e con campioni ogni 60 m serve circa
      30 m per pixel; z14 costerebbe circa 17 GB di quote decodificate contro
      4 GB. z14 si prova cambiando una riga se le misure lo consentono
- [ ] **Campionamento e levigatura**: `long_edge_sampling_distance: 60` con
      `way_point_max_distance: 10`, `interpolate: bilinear`,
      `edge_smoothing: moving_average` con finestra 150 m
      (`config-example.yml:143-161` di GraphHopper: "realistic slopes and
      total altitude values (up and down)"). La finestra si tara confrontando
      la salita con tracce GPS note; in tunnel e sui ponti le quote non vengono
      dal DEM
- [ ] Cache delle quote decodificate e grafo **sul disco locale**, mai sul
      Volume di rete: sono letti ad accesso casuale e si rigenerano
- [ ] **wm-routing legge i dati di wm-tiles, non il contrario**: nessun passo
      dentro gli script di wm-tiles. Periodicamente (di notte) legge la data
      nell'intestazione del PBF (`osmosis_replication_*`, che `aggiorna-osm.sh`
      riscrive) e, se e' piu' recente di quella del grafo in uso, lo
      ricostruisce. Legge anche i rettangoli dalle intestazioni di PBF e
      PMTiles e **fallisce rumorosamente** se mancano o non tornano fra loro o
      con il rettangolo del ritaglio. Il PBF finale non si legge mai a meta':
      `aggiorna-osm.sh` lo scrive in un file temporaneo e lo sposta
      (`pipeline/aggiorna-osm.sh:49`). Il PBF si monta come cartella, non come
      file singolo, perche' dopo lo spostamento un file montato restera'
      quello vecchio
- [ ] Percorsi di PBF e DEM nella configurazione di wm-routing (oggi il PBF
      nazionale e' `data/sources/italia.osm.pbf`, `pipeline/build-italia.sh:35`)
- [ ] Il gateway espone in `/v1/version` la data dei dati del grafo; grafo e
      tile possono essere di giorni diversi, ed e' accettato: la differenza si
      vede li', non si sincronizzano gli scambi
- [ ] Sul Mac si prova su un'area piccola (le celle di prova di wm-tiles);
      l'Italia intera si costruisce solo sul server

### Il pre-passo sul PBF

Prima dell'import, uno script (pyosmium, in container) scrive sulle vie cio'
che GraphHopper non sa ricavare da solo, e salva i valori originali in una
**tabella laterale** ad accesso casuale (SQLite: `way_id -> cai_scale,
sac_scale originale, ghiacciaio, origine, catena lunga`). Il gateway rimette
quei valori nei dettagli della risposta tramite il dettaglio `osm_way_id`,
cosi' la distinzione fra difficolta' CAI, `sac_scale` e sconosciuta non si
perde. Il PBF arricchito e' una copia del dato in ingresso (qualche GB), non un
duplicato da tenere allineato: si rigenera a ogni ricostruzione.

- [ ] **Difficolta' effettiva** scritta in `sac_scale`, che GraphHopper legge
      come `hike_rating` (`OSMHikeRatingParser`: hiking=1 ...
      difficult_alpine_hiking=6). Ordine:
  1. **rete CAI**: `cai_scale`, il massimo fra le relazioni `route=hiking` di
     cui la via fa parte e la via stessa;
  2. **`sac_scale`** della via, dove manca `cai_scale`;
  3. **sconosciuta** dove mancano entrambi (`hike_rating` 0).

  Tabella CAI -> `sac_scale`: T e TQ -> `hiking`, E -> `mountain_hiking`, EE
  -> `demanding_mountain_hiking`, EEA e varianti (EEA:F, EEA:PD, EEA:D) ->
  `alpine_hiking`. Valori trovati nelle relazioni dell'area di prova (16
  ottobre 2026): E 965, T 167, EE 132, EEA:F 2, TQ 1, EEA:PD 1, EEA:D 1, EEA 1.
  Un valore fuori tabella si ignora e si conta nel riepilogo.

  Misurato sull'area di prova (`data/sources/area.osm.pbf`, Apuane e
  Garfagnana): 18.053 vie `highway=path`, 6.118 (34%) in una relazione
  escursionistica, 4.670 (26%) con `sac_scale`
- [ ] **Appartenenza alla rete CAI**: la da' GraphHopper da solo
      (`OSMFootNetworkTagParser` riempie `foot_network` dalle relazioni
      `route=hiking`), e il profilo la usa per preferire i sentieri segnati
- [ ] **Catene di sentieri sconosciuti**: il pre-passo collega le vie di
      difficolta' sconosciuta che condividono un nodo e calcola la lunghezza di
      ogni catena. Quelle oltre **500 m** si marcano scrivendo
      `horse_scale=impossible`, che GraphHopper legge come `horse_rating` 6
      (`OSMHorseRatingParser`): un campo che nessun profilo nostro usa per il
      suo significato, cosi' `hike_rating` resta onesto. Un eventuale
      `horse_scale` originale si salva nella tabella laterale. `horse_rating`
      **non compare mai nei dettagli** della risposta: il gateway lo traduce in
      "difficolta' sconosciuta, tratto lungo". La scelta va scritta nel
      `CLAUDE.md` di wm-routing (un futuro profilo a cavallo non potra' usare
      quel campo)
- [ ] **`trail_visibility`** `bad`, `horrible` o `no` alza la difficolta' di un
      grado
- [ ] **Ghiacciai e zone militari**: `natural=glacier` e le aree `military=*`
      sono poligoni, e il sentiero che le attraversa non porta nessun tag. Il
      pre-passo da' alle vie dentro un ghiacciaio la difficolta' massima (6,
      solo `alpinista`) e alle vie dentro una zona militare `access=no`

### Servizio

- [ ] **Profili sul server** (quelli di default e quelli degli shard), con
      divieti e preferenze fissi nel profilo. I parametri per richiesta
      (`custom_model` in `POST /route`) servono solo alla preview per tarare i
      profili
- [ ] **LM e memoria**: con la preparazione LM una richiesta puo' cambiare un
      valore "only if this cannot decrease any edge weight"
      (`docs/core/custom-models.md`). In esercizio LM solo su `escursionista`,
      gli altri profili senza preparazione finche' le misure non dicono che ci
      stanno. Sulla cella di prova e nella preview **niente LM**: cosi' i
      limiti di prova possono anche allentare un profilo e la taratura resta di
      secondi
- [ ] **Memoria e tempi per profilo misurati** sulla cella di prova prima di
      fissare quanti profili preparare con LM. Stima da verificare: circa
      64 byte per nodo per profilo con 16 landmark
- [ ] Grafo **mappato su file** (MMAP), non nell'heap Java: sotto pressione il
      kernel libera la page cache invece di chiudere un processo. `-Xmx` e il
      tetto del container si fissano dopo le misure
- [ ] **Servizio davanti a GraphHopper** (gateway, Node come wm-tiles), che fa
      tre cose: autorizzazione (shard, profili, CORS, limite di richieste),
      inoltro, rientro sulla traccia. La levigatura la fa GraphHopper,
      l'avvertenza e' un testo fisso, il tempo e' una formula sui totali
- [ ] **Interfaccia propria del servizio**, documentata, versionata nel
      percorso (`/v1/...`), pensata per i due casi d'uso (calcolo del
      tracciato, rientro sulla traccia). Il formato della risposta di
      GraphHopper si puo' riprendere dove conviene, ma non e' un vincolo
- [ ] **Ogni risposta porta nome e versione del profilo e data dei dati.** I
      profili cambiano quando li si tara: ricalcolare una traccia vuol dire
      "stesso profilo, versione attuale". Le tracce non si ricalcolano mai da
      sole: lo fa l'utente
- [ ] **Scambio del grafo**: una sola istanza; durante il riavvio notturno il
      gateway tiene le richieste in coda fino a 60 s invece di rispondere
      "riprova"
- [ ] **Controllo prima dello scambio**: dopo l'import, i percorsi di prova
      girano contro il grafo nuovo. Se uno fallisce, o i nodi calano di piu' del
      5% rispetto al grafo in uso, lo scambio non avviene e lo si segnala in
      modo evidente
- [ ] **Si tiene il grafo precedente** su disco; `config.yml` e profili sono in
      git. Tornare indietro: la cartella di ieri e un riavvio

### Rientro sulla traccia

- [ ] Endpoint per il **rientro sulla traccia**: dati la posizione, la traccia,
      il punto della traccia gia' raggiunto (metri percorsi, mandati dall'app)
      e il **verso** (`avanti`, `indietro`, `piu' vicino`; di serie `avanti`),
      il percorso piu' conveniente per tornarci. Serve a chi segue un sentiero
      e se ne allontana di poco:
  - **si attiva solo dentro una fascia di distanza dalla traccia**: sotto
    ~50 m no (errore del GPS sotto il bosco), sopra un limite massimo no (la
    persona non sta piu' seguendo la traccia). Limite di default **1 km a
    piedi, 2 km in MTB**, configurabile. Il server non tiene stato e non
    conserva posizioni: isteresi e attesa fra una richiesta e l'altra le fa
    l'app ([map-core.md](map-core.md));
  - il punto di rientro si cerca nel verso chiesto rispetto al punto gia'
    raggiunto, che toglie l'ambiguita' delle andate e ritorno sullo stesso
    sentiero;
  - **tre candidati**: il primo punto della traccia nel verso chiesto, poi
    +500 m e +1 km. Un percorso verso ciascuno, in parallelo, e vince il costo
    piu' basso fra rientro e resto del giro dal candidato in poi: il candidato
    piu' lontano vince solo se evita davvero un ostacolo, come un crinale.
    GraphHopper open source non ha un calcolo da un punto verso molti (la
    Matrix API e' solo commerciale, README del repo GraphHopper, 16 ottobre
    2026);
  - la risposta propone anche il **ritorno al punto gia' raggiunto** quando e'
    molto piu' corto del rientro in avanti (meno di un terzo): decide la
    persona;
  - se la persona non e' su una via (un prato, un bosco), il primo tratto e'
    in linea d'aria fino alla via piu' vicina, segnato "fuori sentiero, X m";
  - le tracce che non stanno sulle vie OSM (UGC disegnate a mano, GPX
    importati) si allineano prima alle vie con il map matching. Se il
    risultato si allontana troppo dalla traccia (in media oltre 30 m, o un
    tratto oltre 100 m), il servizio risponde "traccia non sui sentieri OSM"
    e l'app ripiega su direzione e distanza

### Sicurezza e informazioni per l'escursionista

- [ ] **Default prudente**: se l'utente non sceglie niente vale il profilo
      `escursionista`, fino a E. EEA, vie ferrate (`highway=via_ferrata`,
      riconoscibili anche senza difficolta': 15 nell'area di prova) e
      ghiacciai si aprono solo nel profilo `alpinista`; i tratti vietati
      restano esclusi in tutti i profili. Andare oltre E richiede una scelta
      esplicita del profilo
- [ ] **Sentieri di difficolta' sconosciuta**: i collegamenti corti sono
      un'ultima risorsa, con una penalita' che cresce con la lunghezza; le
      catene oltre 500 m seguono la tabella dei profili. Se il calcolo non
      trova un percorso, la risposta suggerisce il profilo successivo
- [ ] **`sac_scale` tratto per tratto** come informazione in piu' dentro il
      tracciato: "il percorso e' EE, la cresta di 1 km e' T4, il resto T2"
- [ ] **Alternative**: dove esiste un passaggio piu' semplice o una variante
      piu' impegnativa, il servizio la propone
- [ ] **Accesso letto per mezzo di trasporto**, prima la regola specifica e
      poi quella generale, come in OSM. I profili escursionistici sono a piedi:
      conta `foot=*`, se manca `access=*`. Il profilo `mtb` e' in bici: conta
      `bicycle=*`, se manca `access=*`. `no` e `private` escludono; `yes`,
      `designated`, `permissive` ammettono; `bicycle=dismount` (bici a mano) si
      ammette con una penalita' forte ed e' segnalato nei dettagli. Si usa il
      parser di GraphHopper (`foot_access`, che gestisce anche le barriere
      `locked=yes`) e lo si verifica con una rete di prova. Misurato sull'area
      di prova (61.434 vie fra sentieri, piste, forestali e scalini): 333
      `access=no`, di cui 155 aperte a piedi, 962 `access=private`, 68
      `foot=no`, 504 `bicycle=no`, 62 `bicycle=dismount`. `access:conditional`
      resta fuori (limite noto)
- [ ] **Avvertenza**: la risposta e la preview dicono che il servizio non
      garantisce la percorribilita', e quanta parte del percorso ha difficolta'
      sconosciuta. Se il tracciato supera i 2000 m fra novembre e maggio,
      un avviso dice che la percorribilita' dipende dalla neve
- [ ] **Dettagli per tratto** nella risposta: difficolta' (dalla tabella
      laterale), fondo, sentiero segnato o no, pendenza, guadi
- [ ] **Tempo di percorrenza calcolato dal gateway**: a piedi la regola DIN
      33466 sui totali che GraphHopper restituisce gia' levigati (valori da
      verificare sulla norma: 4 km/h in piano, 300 m/h in salita, 500 m/h in
      discesa; il maggiore dei due tempi piu' meta' del minore). Non si esprime
      come velocita' tratto per tratto, perche' e' un massimo su totali. In MTB
      il tempo del motore. Il campo `time` di GraphHopper non si espone a
      piedi, per non avere due tempi nella stessa risposta

### Stessa macchina di wm-tiles

- [ ] Container pubblicato solo su `127.0.0.1` ed esposto dal reverse proxy
      gia' presente (Caddy), come prescrive `docs/runbook.md` di wm-tiles
- [ ] Dati condivisi via Volume (montaggi in sola lettura, per cartella),
      nessun trasferimento di rete fra i servizi
- [ ] **Prima dell'import**: memoria libera sufficiente e nessuna
      rigenerazione di wm-tiles in corso (`build-italia.sh`, `build-celle.sh`),
      altrimenti si rinvia alla notte dopo. Il container dell'import ha
      priorita' alta di chiusura in caso di memoria esaurita
      (`oom_score_adj`), cosi' se serve il kernel chiude l'import e non il
      server delle tile
- [ ] Preview e routing sotto un dominio servito dallo stesso Caddy. La
      configurazione di Caddy del routing sta in un file a parte che il
      `Caddyfile` di wm-tiles importa: `infra/pubblica-dominio.sh` riscrive da
      zero `/etc/caddy/Caddyfile` (`cat > /etc/caddy/Caddyfile`), e una
      modifica a mano sparirebbe al primo rilancio

### Servizio pubblico

- [ ] **Limite di richieste nel gateway**, per indirizzo IP e per shard: largo
      per un'app, stretto per chi usa l'indirizzo come API gratuita. Una
      chiave nell'app non protegge, perche' si legge dal codice della webapp
- [ ] Il gateway accetta solo i profili dello shard chiesto
- [ ] **CORS con una lista di origini per shard**, dichiarata nella
      configurazione dello shard: la webapp, i siti dei clienti con l'embed
      (i widget Angular girano nella pagina del cliente, quindi l'origine da
      autorizzare e' il dominio del cliente: ogni sito nuovo va aggiunto),
      l'origine della WebView delle app (da verificare: per Ionic/Capacitor
      e' `capacitor://localhost` su iOS e `http://localhost` su Android).
      Ferma l'uso da siti altrui nel browser, non chi chiama da un programma:
      per quello c'e' il limite di richieste. La produzione oggi risponde
      `Access-Control-Allow-Origin: *` (verificato su
      `graphhopper.webmapp.it/route`, 16 ottobre 2026): la lista di uno shard
      deve contenere tutte le origini da cui le app nuove di quello shard
      chiamano, altrimenti la webapp si rompe senza errori evidenti
- [ ] **Nessuna coordinata nei log**: ne' del gateway, ne' di Caddy (che oggi
      non registra le richieste: il `Caddyfile` non ha `log`), ne' di
      GraphHopper (registro delle richieste di Dropwizard spento, livello
      `WARN`). Una prova cerca una coordinata inviata nei log dei container.
      Diventa una regola nel `CLAUDE.md` di wm-routing

### Preview

- [ ] Frontend **OpenLayers** (nessun MapLibre), con le stesse versioni di
      `ol` e `ol-mapbox-style` validate in wm-tiles (11.0.0 con `ol` 7.3.0)
- [ ] Sfondo: lo `style.json` delle tile vettoriali di wm-tiles
- [ ] Scelta del motore: produzione o nuovo, anche entrambi sovrapposti con
      colori diversi
- [ ] Per ciascun motore i parametri che quel motore sa usare (produzione: il
      profilo; nuovo: il profilo, piu' i limiti per richiesta per provare
      varianti prima di farne un profilo)
- [ ] Per ogni tracciato: distanza, salita, discesa, durata, quota di percorso
      su sentieri segnati; profilo altimetrico
- [ ] Tracciato colorato per tratto secondo i dettagli (difficolta' dalla
      tabella laterale, fondo, segnato, pendenza), a scelta
- [ ] Simulazione del rientro: si fissa una traccia e una posizione fuori
      traccia, e si vede il percorso di rientro
- [ ] Data dei dati del grafo visibile
- [ ] Parametri nell'URL, per condividere un caso

### Confronto con la produzione

- [ ] Un insieme di percorsi di prova (punti noti, tracce UGC esistenti)
      ricalcolati con i due motori; e' un file del repo, e serve anche al
      controllo prima dello scambio del grafo
- [ ] Confronto automatico di distanza, dislivello e quota su sentieri
      segnati; ogni differenza si classifica come voluta o difetto

### Spegnimento della produzione

- [ ] **Criterio scritto ora**: il GraphHopper di produzione si spegne quando
      riceve meno di 50 richieste al giorno dalle app per 30 giorni di fila.
      Non contano i bot ne' la preview di wm-routing, che lo chiama come
      termine di confronto. Il conteggio si fa sul server di produzione (non e'
      la macchina di wm-tiles), senza query string, quindi senza coordinate

## Rischi

- **GraphHopper da un ramo non rilasciato.** La sorgente `pmtiles` c'e' solo
  nel ramo principale: si usa un commit fissato, che non riceve correzioni
  finche' non lo si aggiorna, e il formato del grafo cambia fra versioni (un
  ritorno alla versione precedente richiede di ricostruire il grafo). Si passa
  alla 12.0 rilasciata appena esce.
- **Un problema del routing puo' far cadere anche le tile** (stessa macchina,
  nessuna riserva). Mitigazioni: grafo mappato su file, controllo della memoria
  e delle rigenerazioni di wm-tiles prima dell'import, priorita' di chiusura
  alta per l'import, grafo e quote sul disco locale. Se in esercizio non basta,
  si potenzia il server o si sposta il routing su una macchina sua: per questo
  indirizzo di GraphHopper e percorsi dei dati sono configurabili, e nulla nel
  servizio presume la stessa macchina.
- **Una rigenerazione di wm-tiles che parte durante l'import** non e'
  bloccata (non tocchiamo i suoi script): il kernel chiude l'import, non le
  tile, e l'import si ripete la notte dopo. Le rigenerazioni nazionali sono
  rare e lanciate a mano.
- **Il GraphHopper di produzione resta necessario** finche' sono in uso
  versioni di app che lo chiamano; si spegne con il criterio scritto sopra.
- **Dati OSM incompleti.** Il 74% dei sentieri dell'area di prova non ha
  `sac_scale` e il 66% non sta nella rete CAI: un tratto pericoloso senza tag
  puo' passare come "difficolta' sconosciuta". Mitigazione: i collegamenti
  corti sono solo un'ultima risorsa penalizzata, le catene lunghe sono escluse
  dal profilo di default, tutto e' segnalato nei dettagli e la risposta porta
  un'avvertenza. Neve, chiusure temporanee e `access:conditional` restano
  fuori dal calcolo. Lo stesso vale per `mtb:scale`.
- **`horse_rating` usato come contenitore** per le catene lunghe di sentieri
  sconosciuti: e' un uso diverso dal suo significato, da documentare, e un
  futuro profilo a cavallo non potra' usarlo.

## Out of scope

- Calcolo del percorso sul telefono senza rete
- Navigazione vocale e istruzioni svolta per svolta
- Routing in auto (per esempio fino all'inizio del sentiero)
- **Anello che torna alla partenza** (`round_trip` di GraphHopper): e' un uso
  tipico degli escursionisti e il servizio lo offrirebbe quasi senza lavoro,
  ma oggi nell'app non c'e'. Candidato per un ciclo successivo
- **Rifugi e sorgenti come tappe**, dai POI che wm-tiles ha gia': e' una
  funzione nuova dell'app, da un ciclo successivo
- **Qualsiasi modifica a `map-core` e `wm-core`**: le direttive sono in
  [map-core.md](map-core.md), per quando partira' lo sviluppo lato app
- **Dati propri di uno shard nel routing** (una rete di percorsi che non sta
  in OSM): richiede un import a parte o un grafo in piu'. Sviluppo futuro
- **Lista di origini per le tile** (`tiles.maphub.it` oggi risponde `*`):
  lavoro a parte in wm-tiles, perche' tocca un servizio gia' in uso
- **Adattatore per le app vecchie**: al momento dello spegnimento della
  produzione, `graphhopper.webmapp.it` puo' puntare a una rotta del gateway
  che traduce la richiesta vecchia in quella nuova e la risposta nel formato
  di GraphHopper (`paths[0]` con `points`, `ascend`, `descend`, `distance`,
  `time`, gli unici campi che le app vecchie leggono). Un redirect da solo
  non basta, perche' rimanderebbe la richiesta vecchia cosi' com'e'. Allora si
  decide anche quale profilo corrisponde a `hike`
- Spegnimento del GraphHopper di produzione: resta acceso come termine di
  confronto e per le app vecchie, finche' vale il criterio scritto sopra

## Moduli toccati

Repo **wm-routing** (nuovo, `/Users/bongiu/Documents/wm-routing`):

- configurazione GraphHopper (`config.yml`, custom model dei profili) e
  immagine compilata dal commit fissato
- pre-passo sul PBF (difficolta', catene, ghiacciai, zone militari, tabella
  laterale)
- impacchettamento delle quote in PMTiles
- gateway
- script di costruzione del grafo, controllo prima dello scambio, scambio
- `preview/` (OpenLayers)
- strumento di confronto con la produzione e i percorsi di prova
- `docker-compose.yml`, `CLAUDE.md`, `docs/`

Repo **wm-tiles** (solo infrastruttura):

- `infra/pubblica-dominio.sh` e `docs/runbook.md`: il `Caddyfile` importa il
  file del routing. Togliere il routing vuol dire spegnere i suoi container e
  togliere quel file, senza niente da annullare nella pipeline di wm-tiles

Repo **map-core** e **wm-core**: nessuna modifica in questo ciclo (direttive
future in [map-core.md](map-core.md)).

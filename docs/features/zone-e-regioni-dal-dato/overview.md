> Stato: approvata il 2026-11-21

# Le zone e le regioni dal dato

## Cosa cambia

Il gateway comincia a rispondere a due domande che oggi non sa:
**quali sono le regioni d'Italia, con il loro bbox**, e **quali zone
— massicci, catene, valli, parchi — esistono in un bbox**.

E la tabella dei POI smette di ignorare le citta': oggi conosce Calci e Buti
ma non Pisa, Lucca, Firenze.

Chi chiama smette di dover tenere una propria lista di regioni scritta a mano
e smette di dover indovinare dove sia una zona.

## Perche'

Walkiria sta riprogettando il modo in cui capisce di quale posto si parla.
La direzione decisa e': **i luoghi su cui si calcola un giro e i luoghi che si
nominano devono venire dalla stessa fonte**, cioe' da questi dati. Oggi i nomi
arrivano da un geocoder esterno, che e' una fonte diversa da quella su cui il
motore calcola, e le differenze fra le due costano errori silenziosi.

Tre buchi misurati il 2026-11-21 sul gateway vero (shard `walkiria`, dati OSM
del 2026-10-20) e su OpenStreetMap:

- **le citta' non ci sono.** Sonda di 2 km sul centro: Calci, Vicopisano e
  Barga rispondono col loro nome; Pisa, Lucca, Firenze, Volterra e San Giuliano
  Terme no. I `kind` restituiti sono `village hamlet locality peak saddle spring
  drinking_water viewpoint fountain shelter`: `city` e `town` non ci sono
  affatto. Il commento sopra il filtro dice gia' «abitati»: e' una svista;
- **le zone non ci sono.** In Italia OpenStreetMap ha **285 `place=region`**
  (Alpi Cozie, Alpi del Gran Paradiso, Alpi Orobie, Alpi Feltrine…), ma 203 sono
  relation e 65 way: il pre-passo legge solo nodi, quindi ne vedrebbe 17;
- **le regioni non ci sono.** Tutte e venti esistono come relation
  (`boundary=administrative`, `admin_level=4`, `ISO3166-2=IT-*`), e nessuna e'
  un nodo.

## Punto di partenza

`prepare/enrich.py` riempie la tabella `poi` con `class Pois`, un
`osmium.SimpleHandler` che implementa il solo metodo `node`. Il filtro e' in due
costanti: `POI_KINDS` (coppie tag/valore) e `POI_PLACES`, riga 45, oggi
`{"village", "hamlet", "locality"}`.

Il gateway espone `GET /v1/:shard/poi?lon&lat&radiusM`, con il raggio limitato a
2000 m, e `GET /v1/version`, che dichiara il bbox coperto.

## Requisiti

- <a id="r1"></a>**R1** — Il gateway risponde con **i luoghi abitati che stanno dentro un
  bbox dato**, citta' e paesi insieme: una chiamata, non una serie di sondaggi attorno
  a punti. Oggi Pisa, Lucca, Firenze e Volterra non compaiono da nessuna parte.
- <a id="r2"></a>**R2** — Il gateway risponde con **l'elenco delle regioni che il dato
  contiene**, ciascuna col proprio nome come sta nel dato e col proprio bbox. «Che il
  dato contiene» e non «le venti»: sull'area di prova del Mac le regioni sono zero —
  misurato il 2026-11-21, nella cella di Pisa non esiste nessuna relation
  `admin_level=4` — e un requisito che non si puo' vedere fallire dove si lavora non e'
  un requisito.
- <a id="r3"></a>**R3** — Il gateway risponde con **le zone che stanno dentro un
  bbox dato**, ciascuna col proprio nome e col proprio bbox.
- <a id="r7"></a>**R7** — Chi chiede **sceglie i tipi** che gli interessano, e il numero
  dei risultati e' un limite dichiarato da chi chiama, non l'effetto collaterale di un
  ordinamento per distanza. Misurato il 2026-11-21 sull'endpoint di oggi: una chiamata
  sulla cima del Monte Serra restituisce **gli stessi venti risultati con raggio 2 km, 5 km
  e 20 km** — i venti piu' vicini, tutti entro 1276 m, tutti `locality` e `peak`, **nessun
  paese**. Le `locality` sono quattro volte i paesi e ne occupano il posto.
- <a id="r4"></a>**R4** — Una zona e una regione portano un **bbox**, non un
  punto: sono aree, e un'area ridotta al suo centro non serve a inquadrare
  niente. E' un vincolo di struttura, non un dettaglio di come si scrive.
- <a id="r5"></a>**R5** — Le risposte nuove rispettano la regola del repo sui log:
  nessuna coordinata viene registrata.
- <a id="r6"></a>**R6** — Il pre-passo continua a girare sull'area di prova del Mac
  (cella di Pisa) senza richiedere l'area intera.

- <a id="r8"></a>**R8** — Il pre-passo **dichiara quante aree ha incontrato e quante ne ha
  assemblate**, per tipo. Un'area con membri fuori dal file non si assembla e osmium la
  scarta **senza dire niente**: misurato sull'area di prova, 88 relation `admin_level=8`
  nel file e **70 assemblate, 18 perse in silenzio**. In produzione lo stesso meccanismo
  morde sulle zone che sconfinano, che spariscono lasciando un elenco apparentemente
  completo.

- <a id="r9"></a>**R9** — Le rotte dei dati di `/v1/` **vogliono una credenziale**, e senza
  rispondono con un errore esplicito. Oggi non ne vuole nessuna: verificato il 2026-11-21
  che `POST https://routing.maphub.it/v1/walkiria/route`, senza alcuna intestazione di
  autenticazione, arriva al gateway e risponde `400` sul contenuto della richiesta — non
  `401`, non `403`. `WM_LINK_KEY` e `WM_MCP_TOKEN` esistono ma coprono solo `/g/*` e
  `/mcp` (`gateway/src/server.js:36-51`), e il client di Walkiria manda solo
  `Content-Type: application/json` (`packages/api-client/src/routing.ts:194`).
  `GET /v1/version` resta aperta: dice il bbox coperto e la data del dato, niente
  altro, ed e' la prova di vita che `infra/pubblica-routing.sh` usa dopo il reload.
- <a id="r10"></a>**R10** — L'elenco dei percorsi che non devono uscire su internet
  **e' uno solo**, e la prova che li verifica lo legge da lì. Oggi l'elenco è scritto due
  volte a mano in `infra/pubblica-routing.sh`, nella regola di Caddy (riga 24) e nel ciclo
  che la verifica (riga 49), e tutti e due nominano `poi` e basta: un percorso nuovo
  nascerebbe pubblico e lo script continuerebbe a dire «ok».
- <a id="r11"></a>**R11** — Il controllo che precede lo scambio del grafo **guarda anche il
  dato del pre-passo**: che le tabelle attese esistano, e che il numero di righe di ognuna
  non sia crollato rispetto al grafo in uso, con la stessa soglia del 5% gia' applicata ai
  nodi. Oggi `tools/gate.mjs` verifica i percorsi di prova e i nodi di GraphHopper e non
  legge `ways.sqlite`: `extract_pois` e' fail-soft di proposito (`prepare/enrich.py:75-89`,
  «un errore qui logga e lascia il build valido, senza tabella»), quindi un'estrazione
  fallita produce un grafo che supera il controllo e va in uso **senza POI**, e Walkiria
  dice «sul sentiero non risultano soste». Con le aree questo lavoro rende il passo piu'
  costoso, cioe' quel fallimento piu' probabile.

## Rischi

- **Una credenziale nuova si distribuisce prima di pretenderla.** Il giorno in cui il
  gateway comincia a rifiutare chi non la manda, il backend di Walkiria in produzione deve
  gia' averla nel proprio `.env`: altrimenti i giri smettono di funzionare tutti insieme.
  L'ordine e' obbligato — prima la chiave sulle due macchine, poi il gateway che la esige.
- **Chi chiama `/v1/` non e' solo Walkiria.** Vogliono la credenziale anche
  `tools/log-check.sh`, `tools/compare.mjs`, le prove di integrazione di Walkiria
  (`packages/api-client/test/integration/gateway.test.ts`) e i comandi scritti nel
  runbook. Un lavoro fatto a meta' lascia rossa la verifica dei log, che e' il controllo
  della regola sulle coordinate.
- **Il dato va ricostruito.** Nessuno di questi requisiti ha effetto finche'
  l'enrich non viene rifatto su `italia.osm.pbf` sul server. E' un'operazione
  lunga, da fare in una finestra scelta, e finche' non avviene il gateway
  risponde come oggi.
- **Leggere le aree costa, ma il modo di non pagarlo e' gia' nel repo.** Il commento in
  `enrich()` dice che montare i poligoni sul file intero tiene in memoria tutte le vie
  («248 MB sulla cella di Pisa, decine di GB sul nazionale»), e per questo esiste gia'
  il passaggio con `osmium tags-filter` su un estratto. Le aree nuove **devono riusare
  quel passaggio**: l'estratto per `place=region` e `admin_level=4` e' di circa trecento
  oggetti. Verificato il 2026-11-21 che `tags-filter` **include gia' di default gli
  oggetti referenziati** (l'opzione esistente, `-R`, serve a escluderli): sull'area di
  prova, 79 aree amministrative nel sorgente e 79 dopo il filtro, nessuna persa.
- **Le zone non coprono tutto.** «Monti Pisani» in OpenStreetMap **non esiste**,
  in nessuna forma: verificato con interrogazione diretta su node, way e relation
  nel bbox giusto. Chi chiama non deve aspettarsi che ogni nome di massiccio
  si trovi qui.
- **Le `locality` sono rumore.** In un bbox di 16 km ce ne sono 74, e sono
  cose come «I sodi» o «La netta». Un endpoint che le restituisce senza
  distinguerle le fa pesare quanto un paese.

## Out of scope

- Il disegno nuovo di Walkiria che consuma queste risposte: e' un altro lavoro,
  in un altro repo.
- Togliere il geocoder esterno da Walkiria: potra' avvenire dopo, e non riguarda
  questo repo.
- I confini amministrativi sotto la regione (province, comuni): non servono a
  nessuno dei requisiti qui.
- Rifare l'enrich in produzione: e' un'operazione che decide chi gestisce la
  macchina, e ha i suoi tempi.

## Moduli toccati

Previsti:

- `prepare/enrich.py` — il filtro dei place, e la lettura delle aree
- `prepare/tests/test_enrich.py` — le prove del pre-passo
- lo schema della base dati del pre-passo — una tabella per le aree
- `gateway/` — gli endpoint nuovi e le loro prove
- `docs/` — il runbook di costruzione del grafo, se cambia
- `gateway/src/server.js` e `gateway/src/app.js` — la credenziale sulle rotte dei dati
- `infra/pubblica-routing.sh` — l'elenco unico dei percorsi interni e la prova che lo legge
- `tools/log-check.sh`, `tools/compare.mjs`, `docs/runbook.md` — chi chiama `/v1/`
- `tools/gate.mjs` e `tools/build-graph.sh` — il controllo del dato prima dello scambio

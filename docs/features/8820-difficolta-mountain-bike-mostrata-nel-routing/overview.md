> Ticket: oc:8820

# Difficolta' mountain bike mostrata nel routing, accanto alla scala escursionistica

## Cosa cambia

Oggi, qualunque profilo si scelga, il servizio dice quanto un tratto e' difficile
**per chi cammina**: `T`, `E`, `EE`, `EEA`. Anche in bici. Dopo questo lavoro, con
il profilo `mtb` la stessa risposta parla la lingua del cicloescursionista: le
sigle della scala CAI per la mountain bike (`TC`, `MC`, `BC`, `OC`, `EC`) dove
qualcuno le ha assegnate, il livello di `mtb:scale` nel suo vocabolario
(`S0`-`S6`) dove la sigla CAI non c'e', i colori della mappa e il riepilogo
calcolati su quei valori, e i tratti dove si scende dalla bici segnalati.

**Le due scale non si traducono l'una nell'altra.** Una sigla CAI vale perche'
l'ha assegnata il CAI: ricavarla dalla Singletrail-Skala sarebbe dedurla, cioe'
scrivere al posto del CAI. Sono due valori distinti, e il secondo subentra solo
dove manca il primo.

Il percorso non cambia: il motore sceglie gia' oggi gli itinerari in modo adatto
alla bici. Cambia cosa il servizio **sa dire** di quel percorso.

Tre cose nuove entrano nel pre-passo e una nel gateway:

1. **Una difficolta' MTB accanto a quella escursionistica, non al posto suo.** Un
   tratto ne ha due: una mulattiera e' `EE` a piedi e `BC` in bici, e restano
   vere entrambe.
2. **La stessa gerarchia gia' usata a piedi:** prima il grado dichiarato
   dall'itinerario segnato (`cai_scale:mtb` sulle relazioni `route=mtb`), poi il
   grado del singolo tratto (`mtb:scale` sul way). Dove non c'e' ne' l'uno ne'
   l'altro la difficolta' resta sconosciuta: **le sigle CAI si riportano, non si
   deducono**, perche' sono di chi le assegna e la loro autorevolezza sta li'.
3. **I segnavia degli itinerari MTB** raccolti in un elenco distinto da quello
   dei sentieri a piedi.

## Perche'

Alla demo del 20/10/2026 Piergiorgio Rivara (CAI Parma, cicloescursionismo) ha
chiesto che la colorazione per difficolta' valesse anche per la bici: «questa
cosa qui si puo' sposare anche per i gradi di difficolta' della della mountain
bike e i sentieri segnati della mountain bike». Alessio Piccioli ha risposto
«assolutamente si', assolutamente si'». La citazione e' verificata sulla
trascrizione della call.

Il motivo tecnico e' piu' stretto della richiesta. Il profilo `mtb` **gia' usa**
la scala MTB per scegliere il percorso: `mtb_rating > p_max_mtb_rating` scarta i
tratti oltre il quarto grado, e `mtb_network != MISSING` premia la rete ciclabile
(`engine/profiles/mtb_wm.json`). Ma `prepare/difficulty.py` traduce solo la scala
CAI escursionistica e `sac_scale`: di MTB non c'e' nulla. Il servizio sa gia'
scegliere in bici, non sa ancora **raccontare** in bici.

I dati per farlo ci sono, ma coprono meno di quanto coprano quelli a piedi.
Conteggi su OSM del 21/10/2026, provincia di Parma (Overpass) e cella di prova
(`osmium` su `data/pisa.osm.pbf`):

| | Parma | cella di Pisa |
|---|---|---|
| sentieri e sterrate | 29.968 | 62.002 |
| con `mtb:scale` | 2.685 (9,0%) | 5.884 (9,5%) |
| con `sac_scale` | 637 (2,1%) | 2.251 (3,6%) |
| con `mtb:scale:uphill` | 399 | — |
| relazioni `route=mtb` | 99 | 88 |
| di cui con `cai_scale:mtb` | 27 | 0 |
| relazioni `route=hiking` | 469 | 663 |
| di cui con `cai_scale` | 441 | — |

Il confronto che conta non e' fra `mtb:scale` e `sac_scale`, perche' a piedi la
fonte principale non e' `sac_scale` ma la sigla CAI delle relazioni, che
`effective()` guarda per prima. Contando i tratti davvero coperti, in provincia
di Parma:

| | in bici | a piedi |
|---|---|---|
| tratti coperti da un itinerario con sigla CAI | 928 | 5.680 |
| tratti col grado sul singolo tratto | 2.685 (`mtb:scale`) | 637 (`sac_scale`) |
| totale grezzo sui 29.968 sentieri e sterrate | ~12% | ~21% |

**In bici il dato copre circa la meta' di quello a piedi**, quindi il timore del
ticket era fondato: la differenza e' che la scarsita' non sta dove il ticket la
cercava. Sul singolo tratto il dato bici e' quattro volte piu' ricco (9,0% contro
2,1%); e' la copertura degli itinerari segnati a essere sei volte piu' rada (928
tratti contro 5.680). Il buco non si riempie con una difficolta' dedotta da noi:
una sigla CAI vale perche' l'ha assegnata il CAI, e scriverla al posto suo
toglierebbe autorevolezza proprio al dato che il cliente ci ha chiesto di
mostrare. Dove il dato non c'e', si dice che non c'e'.

## Requisiti

- [ ] Il pre-passo legge le relazioni `route=mtb` e ne raccoglie `cai_scale:mtb`,
      il `ref` e l'id, come gia' fa per `route=hiking|foot`.
- [ ] Il pre-passo legge il livello di `mtb:scale` del way (0-6, modificatori
      `+`/`-` ignorati) e lo conserva com'e': **non** lo traduce in una sigla CAI.
- [ ] La difficolta' MTB di un tratto si risolve in quest'ordine: `cai_scale:mtb`
      dell'itinerario segnato (riportata com'e'), poi il livello di `mtb:scale`
      del way (mostrato come `S0`-`S6`), poi sconosciuta. Nessuna sigla CAI
      viene dedotta da altri tag o da altre scale.
- [ ] La difficolta' escursionistica resta invariata e continua a essere
      calcolata per tutti i tratti: le due convivono, nessuna sostituisce l'altra.
- [ ] Il profilo `mtb` (`engine/profiles/mtb_wm.json`) resta invariato: questo
      lavoro non tocca il custom model, quindi niente rigenerazione del grafo per
      cambio di profilo e nessun aggiornamento di versione e impronta in
      `gateway/config/profiles.json`.
- [ ] I segnavia degli itinerari MTB stanno in una colonna propria della tabella
      laterale, distinta da quella dei sentieri a piedi.
- [ ] Col profilo `mtb` il gateway espone in `difficulty` il valore della fonte
      che vince, nel vocabolario di quella fonte (sigla CAI oppure `S0`-`S6`),
      `origin` esteso alle fonti MTB (`cai_mtb`, `mtb_scale`,
      `none`) e il valore grezzo di `mtb:scale` accanto, come oggi c'e' `sac`.
- [ ] Il `+` delle sigle CAI (`MC+`, `TC+`) non manda il valore fra gli
      sconosciuti: si tratta come gia' si trattano `EEA:F` e `EEA:PD` a piedi
      (`prepare/difficulty.py:20-26`). A Parma riguarda 3 itinerari su 27 in
      discesa e 9 su 27 in salita.
- [ ] `cai_scale:mtb:uphill` (la sigla di salita, presente su 27 itinerari su 27
      a Parma) viene letto e conservato nella tabella laterale, anche se in
      questo ciclo la difficolta' mostrata resta quella di discesa.
- [ ] Le tabelle delle sigle vanno aggiunte in tutti i punti che oggi conoscono
      solo la scala a piedi, altrimenti il tratto esce colorato ma con scritto
      «sconosciuta»: `preview/preview.js:398` (difficolta' complessiva del giro),
      `:440` (etichetta corta), `:649` e `:709` (testo del segmento),
      `preview/scheda.js:40-42` (raggruppamento), `gateway/src/mcp/compact.js:17`
      (chiave di raggruppamento del documento).
- [ ] Il segmento calcolato col profilo di ripiego (`makeFallbackRoute`,
      `gateway/src/route.js:163-178`; per `mtb` il successivo e' `libero`) si
      mostra con la scala del profilo con cui e' stato calcolato, che ogni
      segmento gia' dichiara nel campo `profile` (`route.js:138`).
- [ ] `get_off_bike`, che il gateway gia' riceve da GraphHopper e oggi scarta,
      viene esposto come campo a se' del segmento: e' una condizione, non un
      grado, e non sostituisce la difficolta' del tratto.
- [ ] Un client che legge solo `difficulty` continua a funzionare senza modifiche.
- [ ] La preview colora, elenca in legenda e riepiloga per difficolta' usando la
      scala del profilo attivo.
- [ ] La scheda tecnica mostra la difficolta' nella scala del profilo attivo.
- [ ] I testi nuovi sono in italiano (il repo non ha sistema di traduzioni:
      `preview/index.html` e `preview/scheda.html` dichiarano `lang="it"`).
- [ ] La tabella delle sigle resta scritta in un posto solo per ciascun lato
      (pre-passo e gateway), non ripetuta come accade oggi per la scala a piedi.
- [ ] [UX] La legenda in bici elenca i due vocabolari distinti, ciascuno con la
      sua etichetta scritta accanto al colore, mai il colore da solo.
- [ ] [UX] La tabella dei tratti non mostra una difficolta' risolta: mostra le
      fonti con il loro valore vero (`cai_scale` e `sac_scale` a piedi,
      `cai_scale:mtb` e `mtb:scale` in bici) e segna col colore quella in uso.
      Vale anche per la vista a piedi, dove il valore di `cai_scale` finora non
      si vedeva.
- [ ] [UX] La legenda dichiara in testa quale scala sta mostrando.
- [ ] [UX] «Si scende dalla bici» sta in fondo alla legenda, staccata dai gradi,
      dove oggi stanno `Via ferrata` e `Ghiacciaio`.
- [ ] [UX] Le sigle sono testo anche nel riepilogo e nella scheda, cosi' la
      stampa in bianco e nero resta leggibile; il testo della legenda sta sopra
      4,5:1 di contrasto.

## Rischi

- **La mappa in bici sara' in buona parte grigia.** Senza deduzioni, la
  difficolta' MTB si mostra solo dove qualcuno l'ha dichiarata: a Parma ~12% dei
  sentieri e sterrate, contro ~21% a piedi. E' una conseguenza voluta della
  scelta di riportare e non dedurre, non un difetto da correggere: una sigla CAI
  vale perche' l'ha assegnata il CAI. Mitigazione: il grigio dice «non lo
  sappiamo», che e' vero, e l'avvertenza gia' presente nella risposta resta.
- **Le sigle arrivano a chi legge solo `difficulty` e non le conosce.** I cinque
  punti elencati nei requisiti oggi hanno la tabella della sola scala a piedi e
  ripiegano in silenzio su «sconosciuta»: il tratto esce col colore giusto e la
  parola sbagliata. Mitigazione: sono elencati con `file:riga` nei requisiti, e
  il profilo e' gia' nella risposta sia del giro sia del singolo segmento
  (`gateway/src/route.js:138,142`), quindi la scelta della tabella e' determinata
  dal dato, non dal contesto.
- **Le due tabelle delle sigle divergono gia' oggi, e questo lavoro le
  raddoppia.** `prepare/difficulty.py` conosce `TQ`, che `gateway/src/difficulty.js`
  non ha; il gateway schiaccia i rating 5 e 6 su `EEA`, il pre-passo no. Nessun
  test le confronta. Mitigazione: un test che verifichi la corrispondenza fra le
  tabelle delle due parti, che vale anche per la scala a piedi.
- **Il ramo principale non si puo' provare sui dati locali.** La cella di Pisa ha
  zero relazioni con `cai_scale:mtb`, quindi il caso «sigla dell'itinerario»
  — quello con la priorita' piu' alta — non viene mai esercitato da
  `bash engine/tests/smoke.sh`. Mitigazione: una fixture che riproduca una
  relazione `route=mtb` con `cai_scale:mtb` e `cai_scale:mtb:uphill`, con i
  valori veri del Parmense (`MC`, `BC`, `MC+`).
- **Disallineamento fra tabella laterale e gateway durante il rilascio.** Il
  pre-passo e il gateway escono in momenti diversi, e il gateway ripiega in
  silenzio sulle colonne che trova (`gateway/src/details.js:28-33`). Mitigazione:
  lo stesso trattamento gia' in uso per `refs` e `rel_ids` — un gradino in piu'
  nella cascata — e l'ordine di rilascio: prima i dati, poi il gateway.
- **I gradi alti quasi non si vedranno.** Il profilo `mtb` scarta i tratti oltre
  il quarto grado (`max_mtb_rating: 4`), quindi `OC` ed `EC` compariranno solo
  sui segmenti calcolati col profilo di ripiego. Non e' un guasto, ma spiega
  perche' quei due gradi non avranno casi di prova reali.
- **La scheda stampata e la stessa scheda riaperta dopo il rilascio possono
  contraddirsi.** La scheda si ricostruisce chiedendo di nuovo il percorso al
  gateway (`gateway/src/mcp/documento.js:129-136`): il link firmato porta i punti
  e il profilo, non le difficolta'. Una scheda MTB stampata prima dira' `EE`,
  la stessa riaperta dopo dira' `BC`. Vale per qualunque cambio di calcolo, non
  solo per questo: si segnala, non si risolve qui.

## Out of scope

- **Il tempo di percorrenza in bici.** Non e' un problema da risolvere qui: il
  gateway usa la DIN 33466 solo per i profili a piedi e per gli altri prende il
  tempo di GraphHopper (`gateway/src/route.js:144-147`), gia' calcolato con
  `mtb_average_speed`. Rivedere quanto e' buona quella stima significa toccare il
  custom model, quindi rigenerare il grafo e cambiare versione e impronta del
  profilo: resta fuori da questo ciclo.
- **Il `+` del CAI e la doppia sigla salita/discesa** (`MC+`, `MC/BC`). La
  notazione completa del CAI distingue salita e discesa e segnala le pendenze
  sostenute; qui si mostra una sigla sola. `mtb:scale:uphill` esiste su 399
  tratti nel Parmense, quindi il materiale per farlo c'e' in un ciclo successivo.
- **Un tetto di difficolta' MTB scelto dall'utente**, come i quattro profili a
  piedi fanno con `max_hike_rating`: qui il tetto resta quello fisso del profilo.
- **`map-core` e il lato app**: il `CLAUDE.md` dice che non si tocca finche' non
  parte lo sviluppo lato app.

## Moduli toccati

Tutto nel repo principale `wm-routing`: nessun submodule e' coinvolto.

**Pre-passo (Python)**
- `prepare/difficulty.py` — tabella delle sigle MTB e traduzione di `mtb:scale`,
  accanto a quelle esistenti.
- `prepare/enrich.py` — lettura delle relazioni `route=mtb` (`relation`), calcolo
  della difficolta' MTB accanto a `effective()`, deduzione del `TC` dalla sede
  stradale, nuove colonne della tabella laterale.

**Gateway (Node)**
- `gateway/src/difficulty.js` — traduzione del rating MTB nelle sigle CAI.
- `gateway/src/details.js` — lettura delle nuove colonne, scelta della scala in
  base al profilo, esposizione di `get_off_bike` e del grezzo `mtb:scale`.
- `gateway/src/route.js` — eventuale passaggio del profilo attivo a
  `summarizeDetails`.

**Preview e scheda**
- `preview/preview.js` — colori, legenda e riepilogo per la scala MTB.
- `preview/index.html` — etichette della scala nella scelta della vista.
- `preview/scheda.js`, `preview/scheda.css` — difficolta' nella scala del profilo.

**Test**
- `engine/tests/` — il pre-passo si verifica con `pytest` sulle fixture.
- `gateway/test/` — i test del gateway, fra cui quello sull'impronta dei profili.

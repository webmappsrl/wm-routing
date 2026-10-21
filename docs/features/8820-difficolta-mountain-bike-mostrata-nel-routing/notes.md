> Ticket: oc:8820

# Notes — Difficolta' mountain bike mostrata nel routing

## Divergenze dal piano, task per task

### Task 1: niente traduzione fra le due scale

Il piano prevedeva di tradurre `mtb:scale` (Singletrail-Skala, 0-6) nelle sigle
CAI, con 5 e 6 schiacciati su `EC`. **Tolto in corso d'opera su decisione del
dev**: una sigla CAI vale perche' l'ha assegnata il CAI, e ricavarla da un'altra
scala e' dedurla, cioe' scrivere al posto suo. E' lo stesso principio per cui
non si deduce un `TC` dalle sterrate.

I due valori restano quindi distinti: `cai_scale:mtb` si riporta com'e', e dove
manca si mostra il livello di `mtb:scale` nel suo vocabolario (`S0`-`S6`). La
tabella `MTB_SCALE` e' stata sostituita da `mtb_scale_level`, che normalizza i
modificatori `+`/`-` e restituisce il livello senza interpretarlo.

Conseguenza: in bici la mappa parla due vocabolari invece di uno, e la legenda
li elenca entrambi dichiarando a quale appartiene ogni voce.

### Task 4: la condizione di scendere dalla bici era gia' esposta

Il piano diceva che il gateway riceve `get_off_bike` da GraphHopper e lo scarta.
Non e' vero: `gateway/src/details.js` lo espone gia' come campo `dismount` di
ogni segmento. Nessun campo nuovo e' stato aggiunto; si usa quello.

La colonna separata «Bici a mano» nella tabella dei tratti, aggiunta e poi
tolta, era anch'essa ridondante: la colonna «Segnavia» scrive gia' `, bici a
mano` sui tratti che lo richiedono.

### Task 6: la tabella dei tratti mostra le fonti, non la difficolta' risolta

Il piano prevedeva di aggiungere la scala MTB alle tabelle esistenti, lasciando
la colonna «Difficolta'» con il valore risolto. **Cambiato su decisione del
dev**: quella colonna mostrava una sigla CAI anche quando il dato veniva da
`sac_scale` o da `mtb:scale`, cioe' deduceva una sigla CAI da un dato che CAI
non e'.

La colonna della difficolta' risolta e' stata tolta, e al suo posto ci sono le
due fonti con il loro valore vero: `cai_scale` e `sac_scale` a piedi,
`cai_scale:mtb` e `mtb:scale` in bici. Il pallino colorato segna la fonte che il
servizio sta usando, e ha reso inutile la colonna «Origine», tolta anch'essa.

Questo ha richiesto di esporre dal gateway il campo `cai`, che prima non usciva:
a piedi il valore di `cai_scale` non era mai stato visibile, si vedeva solo la
parola «cai_scale» nella colonna «Origine».

Tolto anche il requisito UX del tratteggio per i gradi dedotti: senza deduzioni
non c'e' piu' niente da distinguere.

### Task 7: la scheda non ha richiesto modifiche

`preview/scheda.js` raggruppa i tratti per `ref|difficolta` usando la stringa
che arriva dal gateway, qualunque essa sia: con la sigla MTB funziona senza
toccare nulla. Stessa cosa per `gateway/src/mcp/compact.js`, dove e' bastato
aggiungere il test.

## Bug trovati

- **Il comando dei test del pre-passo nel `CLAUDE.md` prova il codice sbagliato.**
  `docker run --rm -v "$PWD/engine/tests":/fixtures:ro wm-routing-prepare pytest -q`
  monta solo le fixture, ma `prepare/Dockerfile` fa `COPY . /prepare`: i test
  girano sulla copia congelata dentro l'immagine, non sul codice in locale. Serve
  anche `-v "$PWD/prepare":/prepare`, altrimenti una modifica appena scritta
  risulta verde senza essere stata provata.
- **`gateway/scripts/scheda-check.mjs` fallisce** con
  `banner assente con stamp diverso`. Verificato che fallisce anche con la
  tabella laterale originale e senza le modifiche di questo lavoro: e'
  preesistente o dipende dall'ambiente locale. Non toccato qui.
- **Le due tabelle delle sigle erano gia' divergenti** fra `prepare/difficulty.py`
  (che conosce `TQ`) e `gateway/src/difficulty.js` (che schiaccia i rating 5 e 6
  su `EEA`), e nessun test le confrontava. Ora `gateway/test/sigle-allineate.test.js`
  le confronta, con le divergenze volute dichiarate in un elenco.

## Correzioni dopo la review del branch

Una review a contesto fresco ha trovato undici rilievi; dieci corretti, uno
lasciato e dichiarato.

- **La massima del giro mescolava i due vocabolari.** L'ordinamento unico
  `['S0','S1','TC','S2','MC',...]` era una corrispondenza fra Singletrail-Skala
  e scala CAI scritta nell'ordinamento invece che in una tabella: la stessa
  traduzione che il lavoro dichiara di non fare. Ora si calcolano due massime
  separate e si mostrano entrambe.
- **La vista «colora per origine» era tutta grigia in bici**: `category()`
  conosceva solo `cai` e `sac`, quindi ogni tratto cadeva in «sconosciuta»
  proprio dove il dato c'era. Aggiunte le due voci MTB.
- **I segnavia a piedi sparivano col profilo bici**: il gateway sostituiva
  `ref` con quelli MTB. Ora `refMtb` e `relIdsMtb` stanno accanto a `ref` e
  `relIds`, e la preview mostra entrambi: il numero dipinto sul sasso resta
  anche quando si pedala.
- **Sui tratti di ripiego il valore grezzo finiva sotto l'etichetta sbagliata**:
  la colonna seguiva il profilo del giro e il contenuto quello del segmento. Ora
  il raggruppamento tiene i valori per segmento e l'intestazione lo dichiara.
- **Via ferrata e ghiacciaio erano rimasti senza parola** nella vista a piedi,
  perche' non stanno ne' in `cai_scale` ne' in `sac_scale`: ora la cella scrive
  la condizione.
- **Il raggruppamento univa tratti con tag diversi** (`EEA:F` ed `EEA:PD`, `MC`
  e `MC+`) mostrando il valore del primo per tutta la lunghezza: i grezzi sono
  entrati nella chiave.
- **L'etichetta della difficolta' sconosciuta** diceva «senza cai_scale ne'
  sac_scale» anche in bici; ora dice la scala giusta.
- **Le sigle MTB fuori tabella non si riportavano**: `cai_mtb_unknown_values`
  entra nelle statistiche del pre-passo, come gia' faceva la versione a piedi.
- **`"MC +"` con lo spazio** non veniva riconosciuto: ora si normalizza.
- **`preview-ux-check.mjs` cercava la colonna «Origine»**, tolta di proposito:
  aggiornato a cercare le colonne delle fonti.

Lasciato e dichiarato: **`mtb_rating` ha due significati nella stessa colonna**
(rating CAI 1-5 con `mtb_origin = 'cai_mtb'`, livello 0-6 con `'mtb_scale'`).
Si distinguono solo leggendo `mtb_origin`. E' il prezzo di tenere i due
vocabolari distinti in una colonna sola; chi ordina o filtra per `mtb_rating`
senza guardare l'origine confronta due scale diverse.

## La tabella dei tratti, forma finale

Dopo alcune prove sullo schermo la colonna della difficolta' e' tornata, ma
diversa da quella di partenza: **mostra il valore e, fra parentesi, il tag OSM
da cui viene**, cosi' il valore non e' mai una sigla CAI scritta da noi e si
vede sempre da dove arriva.

```
km   | Lungh. | Difficoltà           | altra fonte | Tipo
0.00 |  339 m | ■ S1 (mtb:scale)     |      —      | sentiero
0.34 |  944 m | ■ forestale          |      —      | forestale
3.30 | 1753 m | ■ MC (cai_scale:mtb) |      1      | sentiero
```

- **Il colore sta sempre in questa colonna**: prima seguiva la fonte in uso e
  cambiava colonna riga per riga, rendendo impossibile scorrere la tabella con
  l'occhio per ritrovare un tratto sulla mappa.
- **`altra fonte`** mostra il dato che c'e' ma non e' quello mostrato — solo
  quando vince la sigla CAI, altrimenti ripeterebbe la colonna accanto.
- **Dove non c'e' un grado si scrive che cos'e' il tratto** (`forestale`,
  `strada terziaria`): dice che li' si passa e perche' non ha un grado.
  `sconosciuta` resta solo per i sentieri, dove il grado esisterebbe ma nessuno
  l'ha dichiarato. La colonna `Tipo` resta: quando la difficolta' e' valorizzata
  il tipo non si vedrebbe da nessun'altra parte.
- **Il livello di `mtb:scale` si scrive `S1`**, come in mappa e in legenda, non
  come il numero nudo del tag: lo stesso dato con un nome solo.
- **La tabella scorre invece di troncare**: `width: max-content` sul contenitore
  che aveva gia' `overflow: auto`, perche' con `width: 100%` «strada
  residenziale» diventava «strada residen...».

## Decisioni

- **Niente deduzione del `TC` dalle sterrate.** Era nell'overview approvata e nei
  requisiti; tolta su decisione del dev con la stessa motivazione del Task 1. La
  conseguenza accettata e' che la mappa in bici resta grigia dove nessuno ha
  dichiarato la difficolta' (circa il 12% dei tratti coperto a Parma).
- **Il tempo di percorrenza resta fuori.** Durante il dialogo era stato incluso
  («sistemiamo»), poi tolto: il gateway usa la DIN 33466 solo per i profili a
  piedi e per gli altri prende il tempo di GraphHopper
  (`gateway/src/route.js:144-147`), quindi il numero sbagliato che si temeva non
  esiste.
- **Il profilo `mtb` non e' stato toccato**, quindi `version` e `sha256` in
  `gateway/config/profiles.json` restano invariati e il grafo non va rigenerato
  per un cambio di profilo (va rigenerato per le colonne nuove della tabella
  laterale, che e' un'altra cosa).
- **Ordine di rilascio:** prima la ricostruzione dei dati sul server, poi il
  gateway. Nell'ordine inverso il gateway ripiega in silenzio sulle colonne
  vecchie e ogni tratto in bici risulta senza difficolta', senza errori nei log.

## Follow-up

- Correggere la riga del comando dei test del pre-passo nel `CLAUDE.md` (vedi
  «Bug trovati»): e' un comando che oggi mente a chi lo esegue.
- Guardare il fallimento di `scheda-check.mjs`, che non riguarda questo lavoro.
- `cai_scale:mtb:uphill` viene letto e conservato, ma la difficolta' mostrata
  resta quella di discesa: la doppia sigla salita/discesa del CAI e' un ciclo a
  se'. A Parma il dato c'e' su 27 itinerari su 27.
- Provare il ramo `cai_scale:mtb` su dati veri: la cella di Pisa ha zero
  itinerari con quella sigla, quindi in locale si esercita solo la fixture.

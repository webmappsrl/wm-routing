// Il server MCP di wm-routing: i tool sono wrapper del gateway /v1, la
// conoscenza d'uso viaggia nelle istruzioni del server e nelle descrizioni
// dei tool, cosi' si aggiorna lato server senza toccare l'utente.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {compactRoute} from './compact.js';
import {encodeLink, LinkError} from './link.js';
import {makeDocumentoTool} from './documento.js';
import {makePoiNearbyTool, makeResolvePoi} from './poi.js';
import {MAX_MARKDOWN} from './markdown.js';
import {profiloPng} from './profilo.js';

// Chiave (Symbol) con cui il tool route passa al wrapper il PNG del profilo: una
// proprieta' non enumerabile, quindi non entra mai nel JSON che va al modello.
const PROFILO = Symbol('profiloPng');

// Tetto dei POI di un giro: oltre, il blob del link smette di essere incollabile.
const MAX_POI = 20;

const PROFILES = ['prudente', 'escursionista', 'esperto', 'alpinista', 'mtb', 'libero'];

export const INSTRUCTIONS = `Sei collegato a wm-routing, il routing escursionistico di Webmapp: percorsi
calcolati su rete sentieristica OSM con quote dal modello del terreno,
difficolta' SAC/CAI e tempi DIN 33466. Hai tre tool: "route" (calcola il
percorso: numeri, tappe, sentieri, avvisi, profilo altimetrico come immagine,
link "linkPreview" e "linkGpx"), "poi_nearby" (punti di interesse vicino a un
punto: nome, tipo, quota, osmId e, dove ci sono, gli identificatori
"wikipedia" e "wikidata"), "giro_finale" (l'export del giro scelto) e
"documento_giro" (il documento completo del giro, col tuo racconto dentro).

Progetti un'escursione per fasi, in questo ordine. I passi si saltano quando
l'informazione c'e' gia' (se l'utente ha detto zona e tempo, non richiederli);
il gate della fase 5 non si salta mai.
1. Raccogli i vincoli mancanti: zona, tempo a disposizione, difficolta',
   interessi e data. Una domanda per volta, saltando cio' che l'utente ha gia'
   detto. La data e' una preferenza come le altre: si chiede fra i vincoli, non la
   imporre e non farne un blocco.
2. Valuta stagione e meteo, prima di proporre le varianti. Non e' rispondere a
   una domanda sul meteo: e' un ingresso della progettazione e cambia
   l'itinerario. Temporale previsto nella finestra di passaggio in cresta:
   preferisci una variante che scollina prima o che passa vicino a un riparo;
   caldo d'agosto: una sorgente diventa una tappa, non una curiosita'. Ripari
   e sorgenti li trovi con "poi_nearby". Se la data non arriva non ti fermi: la
   parte stagionale funziona comunque sulla data di oggi (luce, caldo, neve,
   periodo dell'anno), ragionando sui giorni a venire, come fa chi progetta
   davvero; e offri: "se mi dici il giorno guardo anche la previsione". La
   previsione per una data la recuperi tu con i tuoi strumenti: questo
   servizio non fornisce il meteo. Oltre l'orizzonte in cui una previsione ha
   senso non si inventa una previsione: dillo all'utente e ripiega sulla
   stagione.
3. Proponi 2-3 varianti calcolate con "route" e confrontale con i numeri e col
   profilo altimetrico, dicendo cosa cambia fra l'una e l'altra.
4. Arricchisci il giro scelto: "poi_nearby" sui punti salienti (partenza,
   arrivo, vette e tappe che vedi nel campione di geometria): e' cosi' che
   l'itinerario prende i nomi dei luoghi. Per i POI che portano "wikipedia" o
   "wikidata" usa i TUOI strumenti web su quegli identificatori e racconta i
   luoghi (storia, cosa si vede): questo servizio fornisce solo dati di
   percorso e identificatori, il contenuto lo recuperi tu.
5. Gate: presenta il giro (tappe, numeri, racconto dei luoghi) e chiedi la
   conferma esplicita dell'utente. Senza un si' chiaro non si va avanti: una
   modifica richiesta riporta alla fase 3 o 4.
6. Solo dopo il si', chiama "giro_finale" con punti, profilo e i POI scelti
   come osmId (mai nomi o coordinate), piu' al massimo una nota di una riga
   per POI (viene tagliata a 80 caratteri). Restituisce "linkGpx" (file GPX) e
   "linkScheda" (scheda stampabile del giro), piu' "poiRisolti" e
   "poiMancanti": riferisci sempre i "poiMancanti". Consegna i link.
7. Offri il documento del giro: "documento_giro" con lo stesso blob (la parte
   dopo "?t=" di "linkScheda") e il TUO testo — presentazione, un racconto per
   ogni luogo (per osmId), consigli, fonti. Numeri, nomi, quote e percorso li
   rimette il servizio: non riscriverli nel testo. Restituisce l'HTML in
   "documento" e il nome con cui salvarlo in "nomeFile"; se "luoghiIgnorati"
   non e' zero, qualche osmId non apparteneva al giro: dillo.

Disciplina, non negoziabile:
- ogni numero che riferisci (km, dislivelli, ore, quote, difficolta') viene
  dai tool; i sentieri che citi sono quelli nell'elenco "sentieri";
- se un dato manca o un punto e' fuori dall'area coperta, dillo all'utente
  invece di stimare o inventare;
- i link "linkPreview" (mappa del giro), "linkGpx" (file GPX) e "linkScheda"
  (scheda stampabile) vanno incollati INTATTI, senza riscriverli: sono
  firmati, un link alterato smette di funzionare.

Profili: prudente (solo sentieri facili e ben tracciati), escursionista
(fino a E), esperto (fino a EE), alpinista (tutto, ferrate comprese), mtb,
libero (nessun vincolo). Coordinate sempre [lon, lat], longitudine prima,
da 2 a 25 punti; per un anello ripassa dal punto di partenza. In caso di
"suggerimentoProfilo" proponi all'utente il profilo suggerito. Se negli
avvisi compare "trattiConAltroProfilo", di' all'utente quali tratti sono
stati calcolati con un profilo piu' permissivo del suo: non nasconderlo.`;

// Il tool route: valida, chiama /v1 e compatta. Esportato per i test.
export function makeRouteTool({gatewayUrl, publicUrl = gatewayUrl, linkKey, fetchFn = fetch, profiloFn = profiloPng}) {
  return async function routeTool({points, profile}) {
    if (!Array.isArray(points) || points.length < 2) return {stato: 'punti_insufficienti'};
    if (points.length > 25) return {stato: 'troppi_punti', massimo: 25};
    if (!points.every(p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite)))
      return {stato: 'coordinate_non_valide'};
    let r;
    try {
      r = await fetchFn(`${gatewayUrl}/v1/mcp/route`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({profile, points}),
      });
    } catch { return {stato: 'gateway_non_raggiungibile'}; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const out = {stato: j.stato ?? 'errore'};
      if (j.suggerimento) out.suggerimentoProfilo = j.suggerimento;
      if (j.stato === 'fuori_area') {
        const v = await fetchFn(`${gatewayUrl}/v1/version`).then(x => x.json()).catch(() => null);
        out.avvisi = {fuoriArea: true, area: v?.area ?? null};
      }
      return out;
    }
    const out = compactRoute(j);
    const blob = encodeURIComponent(encodeLink({points, profile, stamp: j.data?.osm ?? ''}, linkKey));
    out.linkPreview = `${publicUrl}/g/?t=${blob}`;
    out.linkGpx = `${publicUrl}/g/gpx?t=${blob}`;
    // il profilo usa la geometria a piena risoluzione; e' un di piu': se il disegno
    // fallisce la risposta resta il solo testo.
    try {
      const png = profiloFn({
        coords: j.geometry?.coordinates ?? [],
        tappeIdx: (j.waypoints ?? []).map(w => w.index),
      });
      Object.defineProperty(out, PROFILO, {value: png, enumerable: false});
    } catch { /* nessuna immagine */ }
    return out;
  };
}

// Il tool giro_finale: dopo la conferma dell'utente compone i deliverable
// (GPX e scheda). Il modello passa solo osmId e note: nome, posizione e quota
// li risolve il server dal database. La rotta /g/scheda e' di un task a parte.
export function makeFinalTool({gatewayUrl, publicUrl = gatewayUrl, linkKey, fetchFn = fetch, waysDbPath = '',
                               resolvePoi = makeResolvePoi({waysDbPath})}) {
  return async function finalTool({points, profile, poi = []}) {
    if (!Array.isArray(points) || points.length < 2) return {stato: 'punti_insufficienti'};
    if (points.length > 25) return {stato: 'troppi_punti', massimo: 25};
    if (!points.every(p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite)))
      return {stato: 'coordinate_non_valide'};
    if (!Array.isArray(poi)) return {stato: 'poi_non_valido'};
    if (poi.length > MAX_POI) return {stato: 'troppi_poi', massimo: MAX_POI};
    if (poi.some(x => !Number.isSafeInteger(x?.osmId))) return {stato: 'poi_non_valido'};
    const {trovati, mancanti, errore} = poi.length ? resolvePoi(poi.map(x => x.osmId)) : {trovati: [], mancanti: []};
    // un guasto del database non e' un POI sparito: non va raccontato come tale
    if (errore) return {stato: 'dati_non_disponibili'};
    if (poi.length && !trovati.length) return {stato: 'poi_non_trovati', poiMancanti: mancanti};
    // la data dei dati e' quella del servizio: il link deve poter dire "dati cambiati"
    const v = await fetchFn(`${gatewayUrl}/v1/version`).then(x => x.json()).catch(() => null);
    if (!v) return {stato: 'gateway_non_raggiungibile'};
    const note = new Map();
    for (const x of poi) if (!note.has(x.osmId)) note.set(x.osmId, x.nota);
    let blob;
    try {
      blob = encodeURIComponent(encodeLink({points, profile, stamp: v.osm ?? '',
        poi: trovati.map(t => ({osmId: t.osmId, nota: note.get(t.osmId)}))}, linkKey));
    } catch (e) {
      if (e instanceof LinkError) return {stato: e.stato};
      throw e;
    }
    return {
      linkGpx: `${publicUrl}/g/gpx?t=${blob}`,
      linkScheda: `${publicUrl}/g/scheda?t=${blob}`,
      poiRisolti: trovati.map(t => ({osmId: t.osmId, name: t.name})),
      poiMancanti: mancanti,
    };
  };
}

export function makeMcpServer(opts) {
  const server = new McpServer({name: 'wm-routing', version: '0.1.0'}, {instructions: INSTRUCTIONS});
  // una riga di log per chiamata tool (nome, esito, ms — mai i parametri).
  // Di serie non logga: nel transport stdio lo stdout e' il protocollo, quindi
  // il logger va passato esplicitamente (lo fa la rotta /mcp del gateway).
  const log = opts.log ?? (() => {});
  const logged = (tool, fn) => async args => {
    const t0 = Date.now();
    const out = await fn(args);
    log({route: '/mcp', tool, status: out.stato ? 400 : 200, ms: Date.now() - t0});
    const content = [{type: 'text', text: JSON.stringify(out)}];
    const png = out[PROFILO];
    if (png) content.push({type: 'image', data: png.toString('base64'), mimeType: 'image/png'});
    return {content, ...(out.stato ? {isError: true} : {})};
  };
  const routeTool = makeRouteTool(opts);
  server.registerTool('route', {
    title: 'Percorso escursionistico calcolato',
    description: 'Calcola un percorso reale sulla rete sentieristica: distanza, dislivelli, ' +
      'ore DIN 33466, sentieri con ref e difficoltà, avvisi, link alla mappa (linkPreview) ' +
      'e al GPX (linkGpx) da incollare intatti. Coordinate [lon, lat], da 2 a 25 punti; per un ' +
      'anello ripeti il punto di partenza alla fine.',
    inputSchema: {
      points: z.array(z.array(z.number()).min(2).max(3)).min(2).max(25)
        .describe('Punti del giro come [lon, lat] (longitudine prima)'),
      profile: z.enum(PROFILES).describe('Profilo di percorrenza'),
    },
  }, logged('route', routeTool));
  const poiNearby = makePoiNearbyTool({waysDbPath: opts.waysDbPath ?? ''});
  server.registerTool('poi_nearby', {
    title: 'Punti di interesse vicini',
    description: 'Cime, valichi, sorgenti e acqua, rifugi e ripari, belvedere e abitati vicino a ' +
      'un punto, con quota, osmid e i tag wikipedia/wikidata come identificatori: per i contenuti ' +
      '(descrizioni, foto) usa i tuoi strumenti web su quegli identificatori.',
    inputSchema: {
      point: z.array(z.number()).min(2).max(3).describe('Punto [lon, lat] (longitudine prima)'),
      radiusM: z.number().min(1).max(2000).optional().describe('Raggio in metri (default 500)'),
    },
  }, logged('poi_nearby', async args => poiNearby(args)));
  const finalTool = makeFinalTool(opts);
  server.registerTool('giro_finale', {
    title: 'Deliverable del giro confermato',
    description: 'Da chiamare UNA volta, dopo che l\'utente ha confermato il giro: produce i deliverable ' +
      'definitivi, il file GPX (linkGpx) e la scheda stampabile (linkScheda), da incollare intatti. ' +
      'I punti di interesse si passano COME osmId presi da poi_nearby (massimo 20): nome, posizione e ' +
      'quota li risolve il servizio, mai tu. La nota e\' una riga tua: oltre gli 80 caratteri viene tagliata. ' +
      'Se la risposta ha poiMancanti, quegli osmId non sono piu\' nei dati e NON sono nei file: ' +
      'dillo all\'utente per nome (usa il nome che gli avevi mostrato), non ignorarlo. ' +
      'poiRisolti elenca i POI che invece ci sono.',
    inputSchema: {
      points: z.array(z.array(z.number()).min(2).max(3)).min(2).max(25)
        .describe('Punti del giro confermato come [lon, lat] (longitudine prima)'),
      profile: z.enum(PROFILES).describe('Profilo di percorrenza'),
      poi: z.array(z.object({
        osmId: z.number().int().describe('osmId preso da poi_nearby'),
        nota: z.string().max(200).optional().describe('Una riga tua sul punto: oltre 80 caratteri viene tagliata'),
      })).max(MAX_POI).optional().describe('POI da portare nei file, come osmId'),
    },
  }, logged('giro_finale', finalTool));
  const documentoTool = makeDocumentoTool(opts);
  server.registerTool('documento_giro', {
    title: 'Documento del giro, col tuo racconto dentro',
    description: 'Dopo "giro_finale": compone il documento completo del giro, una pagina HTML ' +
      'autosufficiente che l\'utente salva su disco e riapre anche senza rete. Accetta il blob "t" ' +
      '(la parte dopo "?t=" di linkScheda, incollata intatta) e SOLO testo tuo in Markdown: ' +
      '"introduzione", "luoghi" (un testo per osmId), "consigli", "fonti" (titolo e url). ' +
      'NON accetta numeri, nomi, quote, coordinate ne\' geometria: quelli li rimette il servizio dai ' +
      'dati firmati, quindi non riscriverli nel testo. Un osmId che non e\' nel giro viene scartato: ' +
      'lo dice "luoghiIgnorati". Restituisce "documento" (l\'HTML da consegnare all\'utente) e ' +
      '"nomeFile" con cui salvarlo.',
    inputSchema: {
      t: z.string().describe('Il blob firmato: la parte dopo "?t=" del linkScheda di giro_finale'),
      introduzione: z.string().max(MAX_MARKDOWN).optional().describe('Presentazione del giro, in Markdown'),
      luoghi: z.array(z.object({
        osmId: z.number().int().describe('osmId di un POI gia\' passato a giro_finale'),
        testo: z.string().max(MAX_MARKDOWN).describe('Il tuo racconto del luogo, in Markdown'),
      })).max(30).optional().describe('Un racconto per luogo, agganciato all\'osmId'),
      consigli: z.string().max(MAX_MARKDOWN).optional().describe('Consigli pratici, in Markdown'),
      fonti: z.array(z.object({
        titolo: z.string().describe('Titolo della fonte'),
        url: z.string().describe('Indirizzo http o https della fonte'),
      })).max(30).optional().describe('Le fonti che hai usato per il racconto'),
    },
  }, logged('documento_giro', documentoTool));
  return server;
}

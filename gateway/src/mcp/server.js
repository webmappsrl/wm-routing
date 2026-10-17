// Il server MCP di wm-routing: i tool sono wrapper del gateway /v1, la
// conoscenza d'uso viaggia nelle istruzioni del server e nelle descrizioni
// dei tool, cosi' si aggiorna lato server senza toccare l'utente.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {compactRoute} from './compact.js';
import {encodeLink} from './link.js';
import {makePoiNearbyTool} from './poi.js';

const PROFILES = ['prudente', 'escursionista', 'esperto', 'alpinista', 'mtb', 'libero'];

export const INSTRUCTIONS = `Sei collegato a wm-routing, il routing escursionistico di Webmapp: percorsi
calcolati su rete sentieristica OSM con quote dal modello del terreno,
difficolta' SAC/CAI e tempi DIN 33466.

Come costruisci un itinerario, senza che l'utente lo chieda passo passo:
1. calcola il percorso con il tool "route";
2. chiama "poi_nearby" sui punti salienti (partenza, arrivo, vette e tappe
   che vedi nel campione di geometria): e' cosi' che l'itinerario prende i
   nomi dei luoghi;
3. per i POI che portano "wikipedia" o "wikidata", usa i TUOI strumenti web
   su quegli identificatori e racconta i luoghi (storia, cosa si vede):
   questo servizio fornisce solo dati di percorso e identificatori, il
   contenuto lo recuperi tu;
4. consegna: itinerario con tappe e numeri, racconto dei luoghi, e i link.

Disciplina, non negoziabile:
- ogni numero che riferisci (km, dislivelli, ore, quote, difficolta') viene
  dai tool; i sentieri che citi sono quelli nell'elenco "sentieri";
- se un dato manca o un punto e' fuori dall'area coperta, dillo all'utente
  invece di stimare o inventare;
- i link "linkPreview" (mappa del giro) e "linkGpx" (file GPX) vanno
  incollati INTATTI, senza riscriverli: sono firmati, un link alterato
  smette di funzionare.

Profili: prudente (solo sentieri facili e ben tracciati), escursionista
(fino a E), esperto (fino a EE), alpinista (tutto, ferrate comprese), mtb,
libero (nessun vincolo). Coordinate sempre [lon, lat], longitudine prima,
da 2 a 25 punti; per un anello ripassa dal punto di partenza. In caso di
"suggerimentoProfilo" proponi all'utente il profilo suggerito. Se negli
avvisi compare "trattiConAltroProfilo", di' all'utente quali tratti sono
stati calcolati con un profilo piu' permissivo del suo: non nasconderlo.`;

// Il tool route: valida, chiama /v1 e compatta. Esportato per i test.
export function makeRouteTool({gatewayUrl, publicUrl = gatewayUrl, linkKey, fetchFn = fetch}) {
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
    return out;
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
    return {content: [{type: 'text', text: JSON.stringify(out)}], ...(out.stato ? {isError: true} : {})};
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
  return server;
}

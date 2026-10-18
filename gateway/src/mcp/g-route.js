// La rotta /g/: espande il link firmato verso la preview, o serve il GPX
// generato dal server. Il blob viaggia in query string (mai nei log). Una
// firma che non torna e' un errore esplicito: mai un giro plausibile ma
// diverso da quello progettato.
import {readFileSync} from 'node:fs';
import express from 'express';
import {decodeLink} from './link.js';
import {toGpx} from './gpx.js';
import {compactRoute} from './compact.js';
import {validPoints, sendError, WARNING} from '../route.js';
import {createRateLimiter} from '../rate-limit.js';
import {logEvent} from '../log.js';

const page = msg => `<!doctype html><meta charset="utf-8"><title>wm-routing</title>` +
  `<p style="font: 16px/1.5 system-ui; max-width: 36em; margin: 3em auto">${msg}</p>`;
const ALTERATO = 'Questo link è stato alterato o troncato: non fidarti del giro che ' +
  'mostrerebbe. Fatti rimandare il link dall’assistente.';

const PREVIEW_DIR = process.env.WM_PREVIEW ?? new URL('../../../preview', import.meta.url).pathname;

// nomi e quote dei POI vengono dal database, la nota dal blob firmato.
// Un guasto del database non e' un POI inesistente: si distingue.
function resolveSchedaPoi(resolvePoi, list) {
  const vuoto = {poi: [], poiMancanti: 0, poiNonDisponibili: false};
  if (!resolvePoi || !list?.length) return vuoto;
  try {
    const r = resolvePoi(list.map(x => x.osmId));
    if (r.errore) return {...vuoto, poiNonDisponibili: true};
    const note = new Map(list.map(x => [x.osmId, x.nota]));
    return {
      poi: r.trovati.map(t => ({name: t.name, kind: t.kind, ele: t.ele, lonLat: [t.lon, t.lat], nota: note.get(t.osmId)})),
      poiMancanti: (r.mancanti?.length ?? 0) + (r.nonValidi ?? 0),
      poiNonDisponibili: false,
    };
  } catch { return {...vuoto, poiNonDisponibili: true}; }
}

export function makeGRouter({compute, shard, bbox, key, resolvePoi, dataStamp, previewDir = PREVIEW_DIR,
                             rate = {capacity: 60, perSecond: 2}}) {
  const router = express.Router();
  // i link sono condivisibili per design e /g/gpx costa un calcolo del motore:
  // il limite per IP protegge il motore condiviso anche senza token
  const limiter = createRateLimiter(rate);
  router.use((req, res, next) => {
    if (!limiter.take(`g|${req.ip}`)) return res.status(429).json({stato: 'troppe_richieste'});
    next();
  });

  // decodifica e validazione comuni; risponde da se' sugli errori
  const parse = (req, res) => {
    let b;
    try { b = decodeLink(req.query.t, key); }
    catch { res.status(400).type('html').send(page(ALTERATO)); return null; }
    if (!validPoints(b.points, bbox)) {
      res.status(400).type('html').send(page(
        `Punti fuori dall’area coperta dal servizio (${bbox.join(', ')}).`));
      return null;
    }
    return b;
  };

  router.get('/', (req, res) => {
    const t0 = Date.now();
    const b = parse(req, res);
    if (b) {
      const p = b.points.map(x => x.map(n => n.toFixed(5)).join(',')).join(';');
      res.redirect(302, '/preview/?' + new URLSearchParams({p, profilo: b.profile, d: b.stamp}));
    }
    logEvent({route: '/g', status: res.statusCode, ms: Date.now() - t0});
  });

  router.get('/gpx', async (req, res) => {
    const t0 = Date.now();
    const b = parse(req, res);
    if (b) {
      try {
        const r = await compute(shard, b.profile, b.points, {checkSnap: false});
        // nomi e quote vengono dal database, la nota dal blob firmato. Se il
        // database non risponde il file scende comunque, con i soli punti del giro,
        // ma lo dichiara nel metadata e nel log (come la scheda, che avvisa in pagina)
        let poi = [];
        let poiNonDisponibili = false;
        if (resolvePoi && b.poi?.length) {
          try {
            const r2 = resolvePoi(b.poi.map(x => x.osmId));
            if (r2.errore) throw new Error('poi');
            const note = new Map(b.poi.map(x => [x.osmId, x.nota]));
            poi = r2.trovati.map(t => ({...t, nota: note.get(t.osmId)}));
          } catch { poi = []; poiNonDisponibili = true; }
        }
        if (poiNonDisponibili) logEvent({route: '/g/gpx', stato: 'poi_non_disponibili'});
        res.set('Content-Disposition', `attachment; filename="percorso-${b.profile}.gpx"`)
          .type('application/gpx+xml')
          .send(toGpx({geometry: r.geometry, points: b.points, profile: b.profile, stamp: b.stamp, poi, poiNonDisponibili}));
      } catch (e) { sendError(res, e); }
    }
    logEvent({route: '/g/gpx', status: res.statusCode, ms: Date.now() - t0});
  });

  // scheda stampabile: la pagina e' statica, i dati li chiede a /g/scheda.json
  // con lo stesso blob (resta in query string, mai in log ne' nel referrer)
  router.get('/scheda', (req, res) => {
    const t0 = Date.now();
    const b = parse(req, res);
    if (b) {
      res.set('Referrer-Policy', 'no-referrer').set('Cache-Control', 'no-store').type('html')
        .send(readFileSync(`${previewDir}/scheda.html`, 'utf8'));
    }
    logEvent({route: '/g/scheda', status: res.statusCode, ms: Date.now() - t0});
  });

  router.get('/scheda.json', async (req, res) => {
    const t0 = Date.now();
    const b = parse(req, res);
    if (b) {
      try {
        const r = await compute(shard, b.profile, b.points, {checkSnap: false});
        const c = compactRoute(r);
        let stampCorrente = null;
        try { stampCorrente = dataStamp?.().osm ?? null; } catch { /* nessun banner */ }
        res.set('Cache-Control', 'no-store').json({
          profilo: c.profilo, distanzaKm: c.distanzaKm, salitaM: c.salitaM, discesaM: c.discesaM,
          oreDIN33466: c.oreDIN33466, quotaMinMaxM: c.quotaMinMaxM, tappe: c.tappe, sentieri: c.sentieri,
          geometry: r.geometry, stamp: b.stamp, stampCorrente,
          avvertenza: WARNING,
          ...resolveSchedaPoi(resolvePoi, b.poi),
        });
      } catch (e) { sendError(res, e); }
    }
    logEvent({route: '/g/scheda.json', status: res.statusCode, ms: Date.now() - t0});
  });

  return router;
}

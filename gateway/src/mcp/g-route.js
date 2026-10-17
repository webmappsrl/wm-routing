// La rotta /g/: espande il link firmato verso la preview, o serve il GPX
// generato dal server. Il blob viaggia in query string (mai nei log). Una
// firma che non torna e' un errore esplicito: mai un giro plausibile ma
// diverso da quello progettato.
import express from 'express';
import {decodeLink} from './link.js';
import {toGpx} from './gpx.js';
import {validPoints, sendError} from '../route.js';
import {createRateLimiter} from '../rate-limit.js';
import {logEvent} from '../log.js';

const page = msg => `<!doctype html><meta charset="utf-8"><title>wm-routing</title>` +
  `<p style="font: 16px/1.5 system-ui; max-width: 36em; margin: 3em auto">${msg}</p>`;
const ALTERATO = 'Questo link è stato alterato o troncato: non fidarti del giro che ' +
  'mostrerebbe. Fatti rimandare il link dall’assistente.';

export function makeGRouter({compute, shard, bbox, key, rate = {capacity: 60, perSecond: 2}}) {
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
        res.set('Content-Disposition', `attachment; filename="percorso-${b.profile}.gpx"`)
          .type('application/gpx+xml')
          .send(toGpx({geometry: r.geometry, points: b.points, profile: b.profile, stamp: b.stamp}));
      } catch (e) { sendError(res, e); }
    }
    logEvent({route: '/g/gpx', status: res.statusCode, ms: Date.now() - t0});
  });

  return router;
}

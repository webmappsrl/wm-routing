import {hikingTimeHours} from './time.js';
import {summarizeDetails} from './details.js';
import {withRetry} from './retry.js';
import {logEvent} from './log.js';
import {haversineM} from './rejoin/geometry.js';

const DETAILS = ['osm_way_id', 'hike_rating', 'surface', 'foot_network', 'average_slope', 'road_class',
                 'road_environment', 'get_off_bike'];
export const WARNING = 'Il servizio non garantisce la percorribilita\' dei sentieri: ' +
  'verifica sul posto condizioni e segnaletica.';
const SNOW_M = 2000, SNOW_MONTHS = new Set([11, 12, 1, 2, 3, 4, 5]);
// Ordine dei profili a piedi: le alternative sono i profili accanto.
const LADDER = ['prudente', 'escursionista', 'esperto', 'alpinista'];
// punti per richiesta: ogni coppia e' un calcolo, e il limite di richieste ne
// conta uno solo; lo shard puo' alzarlo (la preview)
export const MAX_POINTS = 10;
// un punto messo dove il profilo non arriva GraphHopper lo aggancia alla via
// ammessa piu' vicina, anche a centinaia di metri, e ci costruisce il giro senza
// errore (prudente verso la vetta del Monte Serra: 53 km invece di 9)
export const SNAP_MAX_M = 50;

export class HttpError extends Error {
  constructor(status, stato, extra = {}) { super(stato); this.status = status; this.stato = stato; this.extra = extra; }
}

export function sendError(res, e) {
  if (e instanceof HttpError) return res.status(e.status).json({stato: e.stato, ...e.extra});
  logEvent({stato: 'errore', error: String(e?.message ?? e)});   // log.js toglie i numeri decimali
  res.status(500).json({stato: 'errore'});
}

export function validPoint(p, [w, s, e, n]) {
  return Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite)
    && p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;
}

export function validPoints(points, bbox) {
  return Array.isArray(points) && points.length >= 2 && points.every(p => validPoint(p, bbox));
}

export function customModelFor(limits) {
  if (!limits) return undefined;
  const cm = {parameters: {}, priority: []};
  if (limits.maxHikeRating !== undefined) cm.parameters.max_hike_rating = limits.maxHikeRating;
  if (limits.maxSlope !== undefined) cm.parameters.max_slope = limits.maxSlope;
  if (limits.excludeUnknown) cm.priority.push({if: 'road_class == PATH && hike_rating == 0', multiply_by: '0'});
  return cm;
}

export function makeRouteCore({config, engine, waysDb, dataStamp, retry = {}, month = () => new Date().getMonth() + 1}) {
  const nextFor = (shard, engineProfile) => {
    const next = config.profiles[engineProfile].next;
    const suggestion = Object.keys(shard.profiles).find(p => shard.profiles[p] === next);
    return suggestion ? {suggerimento: suggestion} : {};
  };
  // checkSnap: il rientro lo spegne, perche' li' la distanza dalla via e' il
  // tratto "fuori sentiero" e la gestisce lui
  return async function compute(shard, publicProfile, points, {limits, checkSnap = true} = {}) {
    const engineProfile = shard.profiles[publicProfile];
    if (!engineProfile) throw new HttpError(400, 'profilo_non_ammesso');
    const req = {profile: engineProfile, points, points_encoded: false, elevation: true,
                 instructions: false, details: DETAILS};
    const cm = customModelFor(limits);
    if (cm) req.custom_model = cm;
    let r;
    try { r = await withRetry(() => engine.route(req), retry); }
    catch { throw new HttpError(503, 'riprova'); }
    if (r.status >= 500) throw new HttpError(503, 'riprova');
    if (!r.ok) {
      if (/not found|Cannot find point/i.test(r.json?.message ?? ''))
        throw new HttpError(404, 'nessun_percorso', nextFor(shard, engineProfile));
      throw new HttpError(400, 'richiesta_non_valida');
    }
    const p = r.json.paths[0];
    const snapped = p.snapped_waypoints?.coordinates;
    if (checkSnap && snapped) {
      const far = points.findIndex((q, i) => snapped[i] && haversineM(q, snapped[i]) > SNAP_MAX_M);
      if (far >= 0) throw new HttpError(404, 'meta_non_raggiungibile', {punto: far, ...nextFor(shard, engineProfile)});
    }
    const mode = config.profiles[engineProfile].mode;
    const {segments, unknownShare} = summarizeDetails(p, waysDb);
    const maxEle = Math.max(...p.points.coordinates.map(c => c[2] ?? 0));
    return {
      profile: publicProfile, profileVersion: config.profiles[engineProfile].version,
      data: {osm: dataStamp().osm}, distanceM: p.distance, ascendM: p.ascend, descendM: p.descend,
      // a piedi DIN 33466 sui totali; il time del motore non si espone (overview)
      timeH: mode === 'foot'
        ? hikingTimeHours({distanceM: p.distance, ascendM: p.ascend ?? 0, descendM: p.descend ?? 0})
        : p.time / 3600000,
      geometry: p.points, snapped: p.snapped_waypoints, segments, unknownShare,
      warning: WARNING, snowWarning: maxEle > SNOW_M && SNOW_MONTHS.has(month()),
    };
  };
}

export function makeRouteHandler(deps) {
  const compute = makeRouteCore(deps);
  return async (req, res) => {
    const {profile, points, limits, alternatives} = req.body ?? {};
    try {
      if (limits && !req.shard.limits) throw new HttpError(400, 'limiti_non_ammessi');
      if (Array.isArray(points) && points.length > (req.shard.maxPoints ?? MAX_POINTS))
        throw new HttpError(400, 'troppi_punti');
      if (!validPoints(points, deps.bbox)) throw new HttpError(400, 'fuori_area');
      const main = await compute(req.shard, profile, points, {limits});
      main.alternatives = [];
      if (alternatives) {
        const i = LADDER.indexOf(profile);
        // solo i profili a piedi hanno vicini: mtb (e i profili degli shard) nessuno
        const near = i < 0 ? [] : [LADDER[i - 1], LADDER[i + 1]].filter(n => n && req.shard.profiles[n]);
        // un profilo accanto e' un altro profilo del server, non un custom model
        // per richiesta: con LM e' ammesso anche se meno severo
        const alts = await Promise.allSettled(near.map(n => compute(req.shard, n, points)));
        for (const a of alts)
          if (a.status === 'fulfilled' && Math.abs(a.value.distanceM - main.distanceM) / main.distanceM > 0.05)
            main.alternatives.push(a.value);
      }
      res.json(main);
    } catch (e) { sendError(res, e); }
  };
}

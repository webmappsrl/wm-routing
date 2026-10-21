import {hikingTimeHours} from './time.js';
import {summarizeDetails} from './details.js';
import {withRetry} from './retry.js';
import {logEvent} from './log.js';
import {haversineM} from './rejoin/geometry.js';

const DETAILS = ['osm_way_id', 'hike_rating', 'surface', 'foot_network', 'average_slope', 'road_class',
                 'road_environment', 'get_off_bike'];
export const WARNING = 'Il servizio non garantisce la percorribilità dei sentieri: ' +
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

// Per ogni tappa: indice del punto agganciato nella geometria, distanza e tempo
// dalla partenza (DIN 33466 sul prefisso a piedi: i cartelli dei sentieri danno
// il tempo alla tappa, non solo il totale).
export function waypointStats(coords, snapped, {foot, totalTimeH, totals = {}}) {
  if (!snapped?.length || coords.length < 2) return [];
  const dist = [0], up = [0], down = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1, e1 = 0] = coords[i - 1], [x2, y2, e2 = 0] = coords[i];
    const k = Math.cos(((y1 + y2) / 2) * Math.PI / 180);
    dist.push(dist[i - 1] + Math.hypot((x2 - x1) * k, y2 - y1) * 111320);
    up.push(up[i - 1] + Math.max(0, e2 - e1));
    down.push(down[i - 1] + Math.max(0, e1 - e2));
  }
  let from = 0;
  return snapped.map((p, n) => {
    let best = from, bestD = Infinity;
    for (let i = from; i < coords.length; i++) {
      const k = Math.cos(((coords[i][1] + p[1]) / 2) * Math.PI / 180);
      const d = Math.hypot((coords[i][0] - p[0]) * k, coords[i][1] - p[1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    from = best;
    // i cumulati della geometria si riportano ai totali del motore (che correggono
    // per il dislivello): cosi' l'ultima tappa coincide col totale esposto
    const scale = (cum, total) => (cum.at(-1) ? (total ?? cum.at(-1)) * cum[best] / cum.at(-1) : 0);
    const d = scale(dist, totals.distanceM), a = scale(up, totals.ascendM), v = scale(down, totals.descendM);
    const timeH = foot ? hikingTimeHours({distanceM: d, ascendM: a, descendM: v})
      : totalTimeH * (dist.at(-1) ? dist[best] / dist.at(-1) : 0);
    return {punto: n, index: best, distanceM: Math.round(d), timeH};
  });
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
  // Un punto agganciato a oltre SNAP_MAX_M puo' essere due cose diverse: fuori
  // da ogni sentiero (un clic su un prato: si aggancia e si avvisa), oppure
  // dove il profilo non arriva (una vetta su sentieri E con prudente: errore).
  // Le distingue l'aggancio del profilo piu' permissivo dello shard.
  async function checkSnapping({shard, engineProfile, mode, points, req, snapped}) {
    if (!snapped) return [];
    const dist = points.map((q, i) => (snapped[i] ? haversineM(q, snapped[i]) : 0));
    const far = dist.map((d, i) => ({punto: i, distanceM: Math.round(d)})).filter(x => x.distanceM > SNAP_MAX_M);
    if (!far.length) return [];
    const ref = mode === 'foot' ? shard.profiles.alpinista : undefined;
    if (ref && ref !== engineProfile) {
      const {custom_model, ...base} = req;
      const rr = await withRetry(() => engine.route({...base, profile: ref, details: []}), retry).catch(() => null);
      const refSnap = rr?.ok ? rr.json.paths?.[0]?.snapped_waypoints?.coordinates : null;
      const blocked = refSnap && far.find(x => refSnap[x.punto]
        && haversineM(points[x.punto], refSnap[x.punto]) + SNAP_MAX_M < dist[x.punto]);
      if (blocked) throw new HttpError(404, 'meta_non_raggiungibile', {punto: blocked.punto, ...nextFor(shard, engineProfile)});
    }
    return far;
  }
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
    const mode = config.profiles[engineProfile].mode;
    const snappedPts = p.snapped_waypoints?.coordinates;
    const offTrailPoints = checkSnap
      ? await checkSnapping({shard, engineProfile, mode, points, req, snapped: snappedPts})
      : [];
    // il motore parte e arriva nel punto agganciato alla via: il raccordo e' il
    // tratto in linea d'aria fra il punto chiesto e quello, da disegnare
    const connectors = (snappedPts ?? [])
      .map((s, i) => ({punto: i, from: points[i], to: [s[0], s[1]], distanceM: Math.round(haversineM(points[i], s))}))
      .filter(c => c.from && c.distanceM >= 1);
    const summary = summarizeDetails(p, waysDb, mode);
    const segments = summary.segments.map(seg => ({...seg, profile: publicProfile}));
    const {unknownShare} = summary;
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
      offTrailPoints, connectors,
      waypoints: waypointStats(p.points.coordinates, snappedPts,
        {foot: mode === 'foot', totalTimeH: p.time / 3600000,
         totals: {distanceM: p.distance, ascendM: p.ascend ?? 0, descendM: p.descend ?? 0}}),
    };
  };
}

// Mai senza percorso: se il giro non riesce con il profilo scelto, lo si
// calcola tratto per tratto, e il tratto che non riesce passa al profilo
// successivo (next in profiles.json: escursionista -> esperto -> alpinista ->
// libero). I tratti calcolati con un altro profilo si dichiarano in
// fallbackLegs e in ogni segmento (profile).
export function makeFallbackRoute({config, compute}) {
  const nextPublic = (shard, publicProfile) => {
    const next = config.profiles[shard.profiles[publicProfile]]?.next;
    return Object.keys(shard.profiles).find(p => shard.profiles[p] === next);
  };
  const isNoRoute = e => e instanceof HttpError && e.status === 404;

  return async function computeWithFallback(shard, profile, points, {limits} = {}) {
    try {
      return {...(await compute(shard, profile, points, {limits})), fallbackLegs: []};
    } catch (e) {
      if (!isNoRoute(e) || points.length < 2) throw e;
    }
    const legs = await Promise.all(points.slice(1).map(async (b, k) => {
      for (let p = profile; p; p = nextPublic(shard, p)) {
        try { return {r: await compute(shard, p, [points[k], b], {limits: p === profile ? limits : undefined}), profile: p}; }
        catch (e) { if (!isNoRoute(e)) throw e; }
      }
      throw new HttpError(404, 'nessun_percorso', {punto: k + 1});
    }));
    return mergeLegs(config, shard, profile, legs);
  };
}

function mergeLegs(config, shard, profile, legs) {
  const coords = [], segments = [], off = new Map(), conn = new Map();
  let distanceM = 0, ascendM = 0, descendM = 0, timeH = 0, unknownM = 0;
  legs.forEach(({r}, k) => {
    const shift = coords.length ? coords.length - 1 : 0;
    coords.push(...(k ? r.geometry.coordinates.slice(1) : r.geometry.coordinates));
    for (const seg of r.segments) segments.push({...seg, from: seg.from + shift, to: seg.to + shift});
    for (const x of r.offTrailPoints ?? []) off.set(k + x.punto, {punto: k + x.punto, distanceM: x.distanceM});
    for (const c of r.connectors ?? []) conn.set(k + c.punto, {...c, punto: k + c.punto});
    distanceM += r.distanceM; ascendM += r.ascendM ?? 0; descendM += r.descendM ?? 0; timeH += r.timeH;
    unknownM += (r.unknownShare ?? 0) * r.distanceM;
  });
  const first = legs[0].r;
  const mode = config.profiles[shard.profiles[profile]].mode;
  return {
    ...first, profile, profileVersion: config.profiles[shard.profiles[profile]].version,
    distanceM, ascendM, descendM,
    timeH: mode === 'foot' ? hikingTimeHours({distanceM, ascendM, descendM}) : timeH,
    geometry: {type: 'LineString', coordinates: coords},
    snapped: {type: 'MultiPoint', coordinates: legs.flatMap(({r}, k) => (k ? r.snapped?.coordinates?.slice(1) : r.snapped?.coordinates) ?? [])},
    segments, unknownShare: distanceM ? unknownM / distanceM : 0,
    snowWarning: legs.some(({r}) => r.snowWarning),
    offTrailPoints: [...off.values()].sort((a, b) => a.punto - b.punto),
    connectors: [...conn.values()].sort((a, b) => a.punto - b.punto),
    fallbackLegs: legs.map(({profile: p}, k) => ({from: k, to: k + 1, profile: p})).filter(x => x.profile !== profile),
  };
}

export function makeRouteHandler(deps) {
  const compute = makeRouteCore(deps);
  const computeWithFallback = makeFallbackRoute({config: deps.config, compute});
  return async (req, res) => {
    const {profile, points, limits, alternatives} = req.body ?? {};
    try {
      if (limits && !req.shard.limits) throw new HttpError(400, 'limiti_non_ammessi');
      if (Array.isArray(points) && points.length > (req.shard.maxPoints ?? MAX_POINTS))
        throw new HttpError(400, 'troppi_punti');
      if (!validPoints(points, deps.bbox)) throw new HttpError(400, 'fuori_area');
      const main = await computeWithFallback(req.shard, profile, points, {limits});
      main.alternatives = [];
      if (alternatives && !main.fallbackLegs.length) {
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

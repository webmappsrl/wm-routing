import {HttpError, sendError, validPoint} from '../route.js';

const MAX_TRACK_POINTS = 5000;
import {candidates, haversineM, maxDistanceM, meanDistanceM, project, trackLengthM} from './geometry.js';

function toGpx(track) {
  const pts = track.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"></trkpt>`).join('');
  return `<?xml version="1.0"?><gpx version="1.1" creator="wm-routing"><trk><trkseg>${pts}</trkseg></trk></gpx>`;
}

// Il rientro: dentro la fascia di distanza, tre candidati nel verso chiesto,
// un calcolo per ciascuno in parallelo. Punteggio: tempo di rientro piu' due
// volte il tempo del tratto di traccia saltato. Con il resto del giro al posto
// del tratto saltato vincerebbe sempre il candidato piu' lontano (la linea
// d'aria verso di lui e' sempre piu' corta del giro), mentre deve vincere solo
// se evita un ostacolo (overview, "Rientro sulla traccia"). Il server non
// tiene stato: isteresi e attesa le fa l'app.
const SKIP_WEIGHT = 2;
export function makeRejoinHandler({config, engine, compute, bands, offsetsM, matchLimits, bbox}) {
  return async (req, res) => {
    const {profile, position, track: raw, progressM = 0, direction = 'forward', matchTrack = false} = req.body ?? {};
    try {
      if (!validPoint(position, bbox)) throw new HttpError(400, 'fuori_area');
      if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_TRACK_POINTS
          || !raw.every(p => validPoint(p, bbox)) || trackLengthM(raw) < 1)
        throw new HttpError(400, 'traccia_non_valida');
      if (!['forward', 'backward', 'nearest'].includes(direction)) throw new HttpError(400, 'verso_non_valido');
      const engineProfile = req.shard.profiles[profile];
      if (!engineProfile) throw new HttpError(400, 'profilo_non_ammesso');
      const mode = config.profiles[engineProfile].mode;
      let track = raw;
      if (matchTrack) {
        const m = await engine.match(toGpx(raw), engineProfile).catch(() => ({ok: false}));
        const coords = m.ok ? m.json?.paths?.[0]?.points?.coordinates : null;
        if (coords?.length > 1) {
          const matched = coords.map(([x, y]) => [x, y]);
          if (meanDistanceM(raw, matched) > matchLimits.meanM || maxDistanceM(raw, matched) > matchLimits.maxM)
            throw new HttpError(422, 'traccia_non_su_osm');
          track = matched;
        }
      }
      const total = trackLengthM(track);
      const reached = Math.min(Math.max(0, progressM), total);
      const here = direction === 'forward' ? project(track, position, reached)
                 : direction === 'backward' ? project(track, position, 0, reached)
                 : project(track, position);
      if (here.distanceM < bands.minM) return res.json({stato: 'su_traccia'});
      if (here.distanceM > bands.maxM[mode]) return res.json({stato: 'troppo_lontano'});

      const dir = direction === 'nearest' ? (here.alongM >= reached ? 'forward' : 'backward') : direction;
      const cands = candidates(track, here.alongM, offsetsM, dir);
      const speedMps = mode === 'foot' ? 4000 / 3600 : 12000 / 3600;
      const results = await Promise.allSettled(cands.map(c => compute(req.shard, profile, [position, c.point], {checkSnap: false})));
      let best = null;
      results.forEach((r, i) => {
        if (r.status !== 'fulfilled') return;
        const skippedS = Math.abs(cands[i].alongM - here.alongM) / speedMps;
        const score = r.value.timeH * 3600 + SKIP_WEIGHT * skippedS;
        if (!best || score < best.score) best = {score, cand: cands[i], route: r.value};
      });
      if (!best) {
        if (results.some(r => r.reason?.status === 503)) throw new HttpError(503, 'riprova');
        throw new HttpError(404, 'nessun_percorso');
      }
      const out = {stato: 'rientro', joinAtM: best.cand.alongM, route: best.route};
      const snappedStart = best.route.snapped?.coordinates?.[0];
      const off = snappedStart ? haversineM(position, snappedStart) : 0;
      out.offPathM = off > 20 ? off : 0;
      // ritorno al punto gia' raggiunto, se costa meno di un terzo del rientro scelto
      if (dir === 'forward' && best.cand.alongM - reached > 1) {
        const back = await compute(req.shard, profile, [position, project(track, position, reached, reached).point], {checkSnap: false})
          .catch(() => null);
        if (back && back.distanceM < best.route.distanceM / 3) out.backToReached = back;
      }
      res.json(out);
    } catch (e) { sendError(res, e); }
  };
}

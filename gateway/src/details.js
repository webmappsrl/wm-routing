import {ratingToCai} from './difficulty.js';

// I dettagli di GraphHopper sono intervalli [da, a, valore] sugli indici dei
// punti: si spezzano tutti agli stessi confini e si arricchiscono con la
// tabella laterale del pre-passo. horse_rating non si chiede e non si espone:
// e' il contenitore delle catene lunghe (CLAUDE.md).
function cuts(details) {
  const s = new Set();
  for (const list of Object.values(details)) for (const [a, b] of list) { s.add(a); s.add(b); }
  return [...s].sort((x, y) => x - y);
}
const valueAt = (list, i) => list?.find(([a, b]) => a <= i && i < b)?.[2];

function lengthM(coords, from, to) {
  let d = 0;
  for (let i = from; i < to; i++) {
    const [x1, y1] = coords[i], [x2, y2] = coords[i + 1];
    const k = Math.cos(((y1 + y2) / 2) * Math.PI / 180);
    d += Math.hypot((x2 - x1) * k, y2 - y1) * 111320;
  }
  return d;
}

export function summarizeDetails(path, waysDb) {
  const d = path.details ?? {};
  const coords = path.points.coordinates;
  // refs (segnavia) e rel_ids (relazioni, il gancio verso osmfeatures) sono
  // colonne aggiunte dopo: con una tabella laterale vecchia si continua senza
  let lookup = null;
  for (const cols of ['cai, sac, origin, long_chain, refs, rel_ids',
                      'cai, sac, origin, long_chain, refs',
                      'cai, sac, origin, long_chain']) {
    try { lookup = waysDb?.prepare(`select ${cols} from ways where way_id = ?`); break; }
    catch { lookup = null; }
  }
  const c = cuts(d);
  const segments = [];
  let unknownM = 0, totalM = 0;
  for (let k = 0; k + 1 < c.length; k++) {
    const [from, to] = [c[k], c[k + 1]];
    const osmWayId = valueAt(d.osm_way_id, from) ?? null;
    const way = lookup?.get(osmWayId) ?? {};
    const rating = valueAt(d.hike_rating, from) ?? 0;
    const origin = way.origin ?? (rating ? 'sac' : 'none');
    const seg = {
      from, to, difficulty: ratingToCai(rating, origin), origin,
      sac: way.sac ?? null, longChain: way.long_chain === 1, ref: way.refs ?? null, relIds: way.rel_ids ?? null,
      osmWayId,
      surface: valueAt(d.surface, from) ?? null, network: valueAt(d.foot_network, from) ?? null,
      slope: valueAt(d.average_slope, from) ?? null,
      roadClass: valueAt(d.road_class, from) ?? null,
      ford: valueAt(d.road_environment, from) === 'ford',
      dismount: valueAt(d.get_off_bike, from) === true,
    };
    const m = lengthM(coords, from, to);
    totalM += m;
    // strade e forestali non hanno una difficolta' per natura: "sconosciuta"
    // vale solo per i sentieri (come nel profilo, road_class == PATH)
    if (seg.origin === 'none' && seg.roadClass === 'path') unknownM += m;
    segments.push(seg);
  }
  return {segments, unknownShare: totalM ? unknownM / totalM : 0};
}

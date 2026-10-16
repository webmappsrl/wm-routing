const R = 6371008.8;
const rad = d => d * Math.PI / 180;

export function haversineM([x1, y1], [x2, y2]) {
  const dy = rad(y2 - y1), dx = rad(x2 - x1);
  const a = Math.sin(dy / 2) ** 2 + Math.cos(rad(y1)) * Math.cos(rad(y2)) * Math.sin(dx / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function trackLengthM(track) {
  let d = 0;
  for (let i = 1; i < track.length; i++) d += haversineM(track[i - 1], track[i]);
  return d;
}

// Proiezione su un segmento in coordinate locali (equirettangolari): basta per
// segmenti di traccia, lunghi metri o decine di metri.
function projectOnSegment(a, b, p) {
  const k = Math.cos(rad(p[1]));
  const ax = a[0] * k, bx = b[0] * k, px = p[0] * k;
  const dx = bx - ax, dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  return len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
}

export function pointAtM(track, alongM) {
  let along = 0;
  for (let i = 1; i < track.length; i++) {
    const seg = haversineM(track[i - 1], track[i]);
    if (along + seg >= alongM) {
      const t = seg ? (alongM - along) / seg : 0;
      const [a, b] = [track[i - 1], track[i]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    along += seg;
  }
  return track.at(-1);
}

// Il punto della traccia piu' vicino a `point`, cercato fra minAlongM e
// maxAlongM: e' cosi' che il punto gia' raggiunto toglie l'ambiguita' delle
// andate e ritorno. Gli estremi si limitano alla traccia.
export function project(track, point, minAlongM = 0, maxAlongM = Infinity) {
  const total = trackLengthM(track);
  const lo = Math.min(Math.max(0, minAlongM), total);
  const hi = Math.min(Math.max(lo, maxAlongM), total);
  const at = m => {
    const q = pointAtM(track, m);
    return {alongM: m, point: q, distanceM: haversineM(point, q)};
  };
  let best = at(hi);
  let along = 0;
  for (let i = 1; i < track.length; i++) {
    const seg = haversineM(track[i - 1], track[i]);
    if (along + seg >= lo && along <= hi) {
      const t = projectOnSegment(track[i - 1], track[i], point);
      const c = at(Math.min(hi, Math.max(lo, along + t * seg)));
      if (c.distanceM < best.distanceM) best = c;
    }
    along += seg;
  }
  return best;
}

export function candidates(track, fromM, offsetsM, direction) {
  const total = trackLengthM(track);
  const sign = direction === 'backward' ? -1 : 1;
  const seen = new Set(), out = [];
  for (const off of offsetsM) {
    const m = Math.min(total, Math.max(0, fromM + sign * off));
    if (seen.has(Math.round(m))) continue;
    seen.add(Math.round(m));
    out.push({alongM: m, point: pointAtM(track, m)});
  }
  return out;
}

// Distanza media e massima dei punti di `b` (uno ogni 20 m) dalla linea `a`.
function samples(line, stepM = 20) {
  const L = trackLengthM(line), out = [];
  for (let m = 0; m <= L; m += stepM) out.push(pointAtM(line, m));
  return out;
}
export const meanDistanceM = (a, b) => {
  const s = samples(b);
  return s.reduce((acc, p) => acc + project(a, p).distanceM, 0) / s.length;
};
export const maxDistanceM = (a, b) => Math.max(...samples(b).map(p => project(a, p).distanceM));

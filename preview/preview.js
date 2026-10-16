// Preview del routing: tile vettoriali di wm-tiles come sfondo, due motori a
// confronto sugli stessi punti. Lo stato sta nell'URL per condividere un caso.
const SHARD = 'preview';
const PROD = 'https://graphhopper.webmapp.it/route';
const COLORS = {nuovo: '#d0021b', produzione: '#1f6feb'};
const DIFF_COLORS = {T: '#2e7d32', E: '#f9a825', EE: '#e65100', EEA: '#6a1b9a', ghiacciaio: '#00838f'};
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);

function showError(e) { $('err').textContent = e ? String(e?.message ?? e) : ''; }

const state = {
  points: (q.get('p') ?? '').split(';').filter(Boolean).map(s => s.split(',').map(Number)),
  results: {},
};

const routeSource = new ol.source.Vector();
const routeLayer = new ol.layer.Vector({source: routeSource, zIndex: 10, style: f => f.get('style')});
const map = new ol.Map({
  target: 'map',
  view: new ol.View({
    center: ol.proj.fromLonLat((q.get('c') ?? '10.53,43.74').split(',').map(Number)),
    zoom: Number(q.get('z') ?? 13),
  }),
});
olms.apply(map, 'https://tiles.maphub.it/style.json').then(() => map.addLayer(routeLayer)).catch(showError);
window.__wm = {map, state};

for (const [id, key] of [['engine', 'motore'], ['prodProfile', 'prod'], ['colorBy', 'colore'],
                         ['direction', 'verso'], ['progress', 'percorsi']])
  if (q.get(key)) $(id).value = q.get(key);

function syncUrl() {
  const v = map.getView();
  const c = ol.proj.toLonLat(v.getCenter()).map(n => n.toFixed(5)).join(',');
  history.replaceState(null, '', '?' + new URLSearchParams({
    p: state.points.map(x => x.map(n => n.toFixed(5)).join(',')).join(';'),
    motore: $('engine').value, profilo: $('newProfile').value, prod: $('prodProfile').value,
    colore: $('colorBy').value, verso: $('direction').value, percorsi: $('progress').value,
    c, z: v.getZoom().toFixed(1),
  }));
}

async function loadMeta() {
  const [list, stamp] = await Promise.all([
    fetch(`/v1/${SHARD}/profiles`).then(r => r.json()),
    fetch('/v1/version').then(r => r.json()),
  ]);
  $('newProfile').innerHTML = list.map(p => `<option value="${p.name}">${p.name} (v${p.version})</option>`).join('');
  $('newProfile').value = q.get('profilo') ?? 'escursionista';
  $('stamp').textContent = `dati del grafo: ${stamp.osm}`;
}

function limits() {
  const l = {};
  if ($('maxRating').value) l.maxHikeRating = Number($('maxRating').value);
  if ($('maxSlope').value) l.maxSlope = Number($('maxSlope').value);
  if ($('excludeUnknown').checked) l.excludeUnknown = true;
  return Object.keys(l).length ? l : undefined;
}

async function routeNew() {
  const r = await fetch(`/v1/${SHARD}/route`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: $('newProfile').value, points: state.points, limits: limits(), alternatives: true})});
  const j = await r.json();
  if (!r.ok) throw new Error(`nuovo: ${j.stato}${j.suggerimento ? ` (prova ${j.suggerimento})` : ''}`);
  return j;
}

async function routeProd() {
  const r = await fetch(PROD, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: $('prodProfile').value, points: state.points, points_encoded: false,
                          elevation: true, instructions: false, details: ['foot_network']})});
  const j = await r.json();
  if (!r.ok) throw new Error(`produzione: ${j.message}`);
  const p = j.paths[0];
  return {distanceM: p.distance, ascendM: p.ascend, descendM: p.descend, timeH: p.time / 3600000,
          geometry: p.points, segments: (p.details.foot_network ?? []).map(([from, to, v]) =>
            ({from, to, network: v, difficulty: null}))};
}

function segColor(seg) {
  const by = $('colorBy').value;
  if (by === 'difficolta') return seg.longChain ? '#b71c1c' : DIFF_COLORS[seg.difficulty] ?? '#757575';
  if (by === 'segnato') return seg.network && seg.network !== 'missing' ? '#2e7d32' : '#9e9e9e';
  if (by === 'fondo') return seg.surface === 'asphalt' ? '#424242' : '#8d6e63';
  const s = Math.abs(seg.slope ?? 0);
  return s > 25 ? '#b71c1c' : s > 15 ? '#ef6c00' : s > 7 ? '#fbc02d' : '#7cb342';
}

function networkShare(r) {
  const n = r.geometry.coordinates.length - 1;
  if (!n || !r.segments?.length) return null;
  return r.segments.filter(s => s.network && s.network !== 'missing').reduce((a, s) => a + s.to - s.from, 0) / n;
}

function draw() {
  routeSource.clear();
  for (const [name, res] of Object.entries(state.results)) {
    const coords = res.geometry.coordinates.map(c => ol.proj.fromLonLat([c[0], c[1]]));
    const segs = res.segments?.length ? res.segments : [{from: 0, to: coords.length - 1}];
    for (const seg of segs) {
      const color = name === 'nuovo' ? segColor(seg) : COLORS[name];
      routeSource.addFeature(new ol.Feature({geometry: new ol.geom.LineString(coords.slice(seg.from, seg.to + 1)),
        style: new ol.style.Style({stroke: new ol.style.Stroke({color, width: name === 'nuovo' ? 5 : 3,
          lineDash: name === 'produzione' ? [8, 6] : undefined})})}));
    }
  }
  for (const p of state.points)
    routeSource.addFeature(new ol.Feature({geometry: new ol.geom.Point(ol.proj.fromLonLat(p)),
      style: new ol.style.Style({image: new ol.style.Circle({radius: 6, fill: new ol.style.Fill({color: '#000'})})})}));
  stats();
  drawProfile();
}

function stats() {
  $('stats').innerHTML = Object.entries(state.results).map(([n, r]) => {
    const share = networkShare(r);
    return `<tr><td>${n}</td><td>${(r.distanceM / 1000).toFixed(2)} km</td><td>+${Math.round(r.ascendM ?? 0)}</td>` +
      `<td>-${Math.round(r.descendM ?? 0)}</td><td>${r.timeH.toFixed(2)} h</td>` +
      `<td>${share === null ? '' : Math.round(share * 100) + '% segnato'}</td>` +
      `<td>${r.unknownShare !== undefined ? Math.round(r.unknownShare * 100) + '% sconosciuto' : ''}</td></tr>`;
  }).join('');
  const nuovo = state.results.nuovo;
  $('warning').textContent = nuovo
    ? nuovo.warning + (nuovo.snowWarning ? ' Sopra i 2000 m la percorribilita\' dipende dalla neve.' : '') : '';
}

function drawProfile() {
  const cv = $('profile'), ctx = cv.getContext('2d');
  cv.width = cv.clientWidth; cv.height = cv.clientHeight;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const all = Object.values(state.results).flatMap(r => r.geometry.coordinates.map(c => c[2] ?? 0));
  if (!all.length) return;
  const lo = Math.min(...all), hi = Math.max(lo + 1, ...all);
  for (const [name, r] of Object.entries(state.results)) {
    const c = r.geometry.coordinates;
    ctx.strokeStyle = COLORS[name]; ctx.beginPath();
    c.forEach((p, i) => {
      const x = (i / Math.max(1, c.length - 1)) * cv.width;
      const y = cv.height - (((p[2] ?? lo) - lo) / (hi - lo)) * (cv.height - 4) - 2;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
}

async function recompute() {
  showError('');
  state.results = {};
  syncUrl();
  if (state.points.length < 2) return draw();
  const which = $('engine').value;
  const jobs = [];
  if (which !== 'produzione') jobs.push(routeNew().then(r => { state.results.nuovo = r; }));
  if (which !== 'nuovo') jobs.push(routeProd().then(r => { state.results.produzione = r; }));
  const out = await Promise.allSettled(jobs);
  const errs = out.filter(o => o.status === 'rejected').map(o => o.reason?.message ?? o.reason);
  if (errs.length) showError(errs.join('\n'));
  draw();
}

function drawLine(geometry, color) {
  const coords = geometry.coordinates.map(c => ol.proj.fromLonLat([c[0], c[1]]));
  routeSource.addFeature(new ol.Feature({geometry: new ol.geom.LineString(coords),
    style: new ol.style.Style({stroke: new ol.style.Stroke({color, width: 4})})}));
}

async function rejoin(position) {
  const base = state.results.nuovo;
  if (!base) return showError('prima calcola un tracciato con il motore nuovo');
  const track = base.geometry.coordinates.map(c => [c[0], c[1]]);
  const r = await fetch(`/v1/${SHARD}/rejoin`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: $('newProfile').value, position, track, progressM: Number($('progress').value),
                          direction: $('direction').value, matchTrack: true})});
  const j = await r.json();
  if (j.stato !== 'rientro') return showError(`rientro: ${j.stato}`);
  drawLine(j.route.geometry, '#00c853');
  if (j.backToReached) drawLine(j.backToReached.geometry, '#00b8d4');
  $('warning').textContent = `rientro a ${(j.joinAtM / 1000).toFixed(2)} km della traccia` +
    (j.offPathM ? `, primo tratto fuori sentiero ${Math.round(j.offPathM)} m` : '') +
    (j.backToReached ? '; in azzurro il ritorno al punto raggiunto' : '');
}

map.on('singleclick', e => {
  const p = ol.proj.toLonLat(e.coordinate);
  if ($('rejoinMode').checked) return rejoin(p).catch(showError);
  state.points.push(p);
  recompute().catch(showError);
});
for (const id of ['engine', 'newProfile', 'prodProfile', 'maxRating', 'maxSlope', 'excludeUnknown'])
  $(id).addEventListener('change', () => recompute().catch(showError));
$('colorBy').addEventListener('change', () => { syncUrl(); draw(); });
for (const id of ['direction', 'progress']) $(id).addEventListener('change', syncUrl);
$('clear').addEventListener('click', () => { state.points = []; recompute().catch(showError); });
map.on('moveend', syncUrl);
loadMeta().then(recompute).catch(showError);

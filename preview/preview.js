// Preview del routing: tile vettoriali di wm-tiles come sfondo, due motori a
// confronto sugli stessi punti. Ogni controllo dice cosa fa, ogni colore ha la
// sua legenda. Lo stato sta nell'URL per condividere un caso.
const SHARD = 'preview';
const PROD = 'https://graphhopper.webmapp.it/route';
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);

// --- testi ---------------------------------------------------------------

const ENGINE_HELP = {
  nuovo: 'Solo il motore nuovo. Il tracciato è colorato per tratto secondo il criterio scelto nella legenda.',
  produzione: 'Solo il GraphHopper di produzione, come lo vedono oggi le app: non conosce la difficoltà dei ' +
    'sentieri e usa un altro modello del terreno.',
  entrambi: 'I due motori sovrapposti: il nuovo colorato per tratto, la produzione in blu tratteggiato.',
};
const PROFILE_HELP = {
  prudente: 'Per famiglie e principianti: fino a T, niente sentieri di difficoltà sconosciuta, pendenze ' +
    'oltre il 25% fortemente penalizzate.',
  escursionista: "Il profilo di default: fino a E. I collegamenti brevi di difficoltà sconosciuta sono " +
    "un'ultima risorsa; i tratti sconosciuti lunghi oltre 500 m sono esclusi.",
  esperto: 'Per chi va su EE: fino a EE, tratti sconosciuti lunghi ammessi ma fortemente penalizzati.',
  alpinista: "Tutto, comprese EEA, vie ferrate e ghiacciai. È l'unico profilo che li apre.",
  mtb: 'In mountain bike: niente scalini, mtb:scale limitato, i tratti a bici a mano penalizzati.',
  prova_escursionista: "Esempio di profilo di uno shard: come escursionista, con un'area chiusa dall'ente.",
};
const PROD_HELP = {hike: 'escursionismo', foot: 'a piedi', bike: 'in bici'};
const ERRORS = {
  fuori_area: "Uno dei punti è fuori dall'area coperta dai dati (il riquadro rosso).",
  nessun_percorso: 'Nessun percorso fra questi punti con il profilo scelto.',
  meta_non_raggiungibile: 'Il punto {punto} non è raggiungibile con questo profilo: ci si arriva solo da ' +
    'sentieri che il profilo esclude.',
  troppi_punti: 'Troppi punti: al massimo 25 nella preview.',
  riprova: 'Il motore si sta riavviando: riprova fra qualche secondo.',
  limiti_non_ammessi: 'Questo shard non accetta i limiti di prova.',
  profilo_non_ammesso: 'Profilo non disponibile per questo shard.',
  richiesta_non_valida: 'Il motore ha rifiutato la richiesta (con LM un limite di prova può solo restringere ' +
    'il profilo, non allentarlo).',
  troppe_richieste: 'Troppe richieste in poco tempo: aspetta qualche secondo.',
  su_traccia: 'La persona è a meno di 50 m dalla traccia: è sulla traccia, il rientro non serve.',
  troppo_lontano: 'La persona è oltre 1 km dalla traccia (2 km in MTB): non la sta più seguendo, il ' +
    'rientro non si attiva.',
  traccia_non_valida: 'La traccia non è valida.',
  traccia_non_su_osm: 'La traccia non segue i sentieri di OpenStreetMap: si può indicare solo direzione e ' +
    'distanza.',
  errore: 'Errore inatteso del servizio.',
};
const explain = j => (ERRORS[j.stato] ?? j.stato ?? 'errore').replace('{punto}', (j.punto ?? 0) + 1) +
  (j.suggerimento ? ` Prova il profilo ${j.suggerimento}.` : '');

// --- colori e legende ------------------------------------------------------

const LINES = [
  {label: 'Motore nuovo (colorato per tratto)', color: '#d0021b', width: 5},
  {label: 'Produzione', color: '#1f6feb', dash: true},
  {label: 'Alternativa del motore nuovo (profilo accanto)', color: '#8e44ad', dash: true},
  {label: 'Rientro sulla traccia', color: '#00c853', width: 4},
  {label: 'Ritorno al punto già raggiunto', color: '#00b8d4', width: 4},
  {label: 'Punto del giro (numerato)', color: '#111', dot: true},
  {label: 'Posizione simulata della persona', color: '#00c853', dot: true},
  {label: 'Raccordo in linea d\'aria: dal punto cliccato alla via dove parte il percorso', color: '#555', dash: true},
  {label: 'Area coperta dai dati', color: '#e53935', dash: true},
  {label: 'Tratto calcolato con un profilo più permissivo (bordo tratteggiato)', color: '#111', dash: true},
];
const COLOR_SETS = {
  difficolta: [
    {key: 'T', label: 'T - turistico', color: '#2e7d32'},
    {key: 'E', label: 'E - escursionistico', color: '#f9a825'},
    {key: 'EE', label: 'EE - per escursionisti esperti', color: '#e65100'},
    {key: 'EEA', label: 'EEA - con attrezzatura', color: '#6a1b9a'},
    {key: 'via ferrata', label: 'Via ferrata', color: '#ad1457'},
    {key: 'ghiacciaio', label: 'Ghiacciaio', color: '#00838f'},
    {key: 'long', label: 'Sentiero sconosciuto lungo (oltre 500 m)', color: '#b71c1c'},
    {key: null, label: 'Sentiero di difficoltà sconosciuta', color: '#9e9e9e'},
    {key: 'road', label: 'Strada o forestale (nessuna difficoltà)', color: '#455a64'},
  ],
  segnato: [
    {key: true, label: 'Sentiero segnato (rete escursionistica)', color: '#2e7d32'},
    {key: false, label: 'Non segnato', color: '#9e9e9e'},
  ],
  fondo: [
    {key: 'asfalto', label: 'Asfalto o pavimentato', color: '#424242'},
    {key: 'sterrato', label: 'Sterrato, ghiaia, terra', color: '#8d6e63'},
    {key: 'ignoto', label: 'Fondo non indicato in OSM', color: '#bdbdbd'},
  ],
  origine: [
    {key: 'cai', label: 'Da cai_scale (relazione della rete CAI)', color: '#1565c0'},
    {key: 'sac', label: 'Da sac_scale della singola via', color: '#00897b'},
    {key: 'special', label: 'Via ferrata o ghiacciaio', color: '#ad1457'},
    {key: 'none', label: 'Sentiero di difficoltà sconosciuta', color: '#9e9e9e'},
    {key: 'road', label: 'Strada o forestale (nessuna difficoltà)', color: '#455a64'},
  ],
  pendenza: [
    {key: 0, label: 'fino al 7%', color: '#7cb342'},
    {key: 1, label: 'dal 7% al 15%', color: '#fbc02d'},
    {key: 2, label: 'dal 15% al 25%', color: '#ef6c00'},
    {key: 3, label: 'oltre il 25%', color: '#b71c1c'},
  ],
};
const PAVED = new Set(['asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'cobblestone']);

function category(seg, by) {
  if (by === 'difficolta') {
    if (seg.longChain) return 'long';
    if (seg.difficulty) return seg.difficulty;
    return seg.roadClass && seg.roadClass !== 'path' ? 'road' : null;
  }
  if (by === 'segnato') return !!seg.network && seg.network !== 'missing';
  if (by === 'origine') {
    if (seg.origin === 'glacier' || seg.origin === 'via_ferrata') return 'special';
    if (seg.origin === 'cai' || seg.origin === 'sac') return seg.origin;
    return seg.roadClass && seg.roadClass !== 'path' ? 'road' : 'none';
  }
  if (by === 'fondo') return !seg.surface || seg.surface === 'missing' ? 'ignoto' : PAVED.has(seg.surface) ? 'asfalto' : 'sterrato';
  const s = Math.abs(seg.slope ?? 0);
  return s > 25 ? 3 : s > 15 ? 2 : s > 7 ? 1 : 0;
}
const segColor = (seg, by) => (COLOR_SETS[by].find(c => c.key === category(seg, by)) ?? {color: '#9e9e9e'}).color;

function swatch(item) {
  const cls = item.dot ? 'swatch dot' : item.dash ? 'swatch dash' : 'swatch';
  const style = item.dot ? `background:${item.color}` : `border-top-color:${item.color}`;
  return `<span class="${cls}" style="${style}"></span>`;
}
function drawLegends() {
  $('legend-lines').innerHTML = LINES.map(l => `<li>${swatch(l)}${l.label}</li>`).join('');
  $('legend-colors').innerHTML = COLOR_SETS[$('colorBy').value].map(c => `<li>${swatch(c)}${c.label}</li>`).join('');
}

// --- telefono: pannello dal basso, schede, riepilogo --------------------------

const mobile = matchMedia('(max-width: 760px)');
const touch = matchMedia('(pointer: coarse)');
// tre altezze: chiuso (riepilogo e schede), meta' schermo, quasi tutto
const safeBottom = () => parseFloat(getComputedStyle($('panel')).paddingBottom) || 0;
const SHEET = {low: () => $('sheet-top').offsetHeight + safeBottom() + 2, mid: () => innerHeight * 0.5, high: () => innerHeight * 0.88};
function sheetHeight(h) {
  document.documentElement.style.setProperty('--sheet-h', `${Math.round(h)}px`);
}
function setSheet(name) {
  document.body.dataset.sheet = name;
  sheetHeight(SHEET[name]());
  if (name !== 'low' && document.body.dataset.tab === 'percorso') requestAnimationFrame(drawProfile);
}
function setTab(tab) {
  document.body.dataset.tab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('panel-body').scrollTop = 0;
  if (tab === 'percorso') requestAnimationFrame(drawProfile);   // nascosto, il canvas ha larghezza zero
}
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => {
  setTab(b.dataset.tab);
  if (document.body.dataset.sheet === 'low') setSheet('mid');
}));

// la maniglia: un tocco passa all'altezza successiva, trascinandola si sceglie
{
  const order = ['low', 'mid', 'high'];
  let start = null;
  const handle = $('sheet-handle'), panel = $('panel');
  handle.addEventListener('pointerdown', e => {
    start = {y: e.clientY, h: panel.offsetHeight, moved: false};
    handle.setPointerCapture(e.pointerId);
    panel.classList.add('dragging');
  });
  handle.addEventListener('pointermove', e => {
    if (!start) return;
    const dy = start.y - e.clientY;
    if (Math.abs(dy) > 6) start.moved = true;
    if (start.moved) sheetHeight(Math.max(SHEET.low(), Math.min(SHEET.high(), start.h + dy)));
  });
  const end = () => {
    if (!start) return;
    panel.classList.remove('dragging');
    if (!start.moved) {
      const cur = order.indexOf(document.body.dataset.sheet);
      setSheet(order[(cur + 1) % order.length]);
    } else {
      const h = panel.offsetHeight;
      setSheet(order.reduce((a, b) => (Math.abs(SHEET[b]() - h) < Math.abs(SHEET[a]() - h) ? b : a)));
    }
    start = null;
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
addEventListener('resize', () => setSheet(document.body.dataset.sheet ?? 'low'));

// la riga del pannello chiuso: cosa fare, oppure il riepilogo dei due motori
function drawMini() {
  const el = $('mini');
  if (!el) return;
  const {nuovo, produzione} = state.results;
  const line = (name, r) => `${name} <b>${(r.distanceM / 1000).toFixed(1)} km · +${Math.round(r.ascendM ?? 0)} m · ` +
    `${hours(r.timeH)}</b>`;
  const err = $('err').textContent.trim();
  el.innerHTML = state.rejoinLoading ? 'Calcolo del rientro…'
    : rejoinOn ? 'Simulazione del rientro attiva: tocca dove si trova la persona.'
    : err ? `<span class="err">${err.split('\n')[0]}</span>`
    : state.flash ? `<b>${state.flash}</b>`
    : state.loading ? 'Calcolo del percorso…'
    : state.points.length < 2 ? `Tocca la mappa per aggiungere i punti del giro: ${state.points.length ? 'ne manca uno' : 'ne servono almeno due'}.`
    : [nuovo && line('Nuovo', nuovo), produzione && line('Produzione', produzione)].filter(Boolean).join('<br>');
  // il testo cambia di altezza: il pannello chiuso deve seguirlo
  if (document.body.dataset.sheet === 'low') sheetHeight(SHEET.low());
}

// spazio occupato dal pannello in basso, per inquadrare sopra di lui
const fitPadding = p => [p, p / 2, (mobile.matches ? $('panel').offsetHeight : 0) + p / 2, p / 2];
function fitRoute() {
  const ext = routeSource.getExtent();
  if (ol.extent.isEmpty(ext)) return;
  map.getView().fit(ext, {padding: fitPadding(60), maxZoom: 16, duration: 300});
}
$('fit').addEventListener('click', fitRoute);

// --- mappa ---------------------------------------------------------------

const state = {
  points: (q.get('p') ?? '').split(';').filter(Boolean).map(s => s.split(',').map(Number)),
  poi: [],                       // per ogni punto, il punto di interesse delle tile da cui viene (o null)
  results: {},
  offTrail: [],
};
const routeSource = new ol.source.Vector();
const routeLayer = new ol.layer.Vector({source: routeSource, zIndex: 10, style: f => f.get('style')});
// Sul telefono la mappa si disegna a densita' 1. ol-mapbox-style ne fa decine di
// layer `hybrid`, ognuno con un canvas per tile: a densita' 3 superano dopo pochi
// spostamenti il tetto che Safari su iPhone concede ai canvas, e la pagina viene
// chiusa e ricaricata senza errori (la vista torna all'inizio). Stesso difetto e
// stessa correzione della preview di wm-tiles (4180256).
const phone = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
const map = new ol.Map({
  target: 'map',
  ...(phone ? {pixelRatio: 1} : {}),
  view: new ol.View({
    center: ol.proj.fromLonLat((q.get('c') ?? '10.53,43.74').split(',').map(Number)),
    zoom: Number(q.get('z') ?? 13),
  }),
});
window.__wm = {map, state, routeSource};
olms.apply(map, 'https://tiles.maphub.it/style.json').then(() => map.addLayer(routeLayer)).catch(showError);

function showError(e) { $('err').textContent = e ? String(e?.message ?? e) : ''; drawMini(); }
const engineMode = () => document.querySelector('input[name=engine]:checked').value;

function drawArea(area) {
  if (!area) return;
  const [w, s, e, n] = area;
  const ring = [[w, s], [e, s], [e, n], [w, n], [w, s]].map(c => ol.proj.fromLonLat(c));
  const layer = new ol.layer.Vector({zIndex: 9,
    source: new ol.source.Vector({features: [new ol.Feature(new ol.geom.Polygon([ring]))]}),
    style: new ol.style.Style({stroke: new ol.style.Stroke({color: '#e53935', width: 2, lineDash: [10, 6]})})});
  map.addLayer(layer);
  window.__wm.areaLayer = layer;
}

// --- stato nell'URL ------------------------------------------------------

for (const [id, key] of [['prodProfile', 'prod'], ['colorBy', 'colore'], ['direction', 'verso'], ['progress', 'percorsi']])
  if (q.get(key)) $(id).value = q.get(key);
if (q.get('motore')) document.querySelector(`input[name=engine][value=${q.get('motore')}]`)?.click();

function syncUrl() {
  const v = map.getView();
  const c = ol.proj.toLonLat(v.getCenter()).map(n => n.toFixed(5)).join(',');
  history.replaceState(null, '', '?' + new URLSearchParams({
    p: state.points.map(x => x.map(n => n.toFixed(5)).join(',')).join(';'),
    motore: engineMode(), profilo: $('newProfile').value, prod: $('prodProfile').value,
    colore: $('colorBy').value, verso: $('direction').value, percorsi: $('progress').value,
    c, z: v.getZoom().toFixed(1),
  }));
}

// --- motori ----------------------------------------------------------------

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
  if (!r.ok) throw new Error('Motore nuovo: ' + explain(j));
  return j;
}

async function routeProd() {
  const r = await fetch(PROD, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: $('prodProfile').value, points: state.points, points_encoded: false,
                          elevation: true, instructions: false, details: ['foot_network']})});
  const j = await r.json();
  if (!r.ok) throw new Error('Produzione: ' + j.message);
  const p = j.paths[0];
  const snapped = p.snapped_waypoints?.coordinates ?? [];
  const connectors = snapped.map((sp, i) => ({punto: i, from: state.points[i], to: [sp[0], sp[1]]}))
    .filter(c => c.from && (Math.abs(c.from[0] - c.to[0]) + Math.abs(c.from[1] - c.to[1])) > 1e-5);
  return {distanceM: p.distance, ascendM: p.ascend, descendM: p.descend, timeH: p.time / 3600000,
          geometry: p.points, timeSource: 'velocità del motore', connectors,
          segments: (p.details.foot_network ?? []).map(([from, to, v]) => ({from, to, network: v}))};
}

// --- disegno -------------------------------------------------------------

const lineStyle = (color, width = 3, dash) =>
  new ol.style.Style({stroke: new ol.style.Stroke({color, width, lineDash: dash})});

function addLine(coords, style, props = {}) {
  routeSource.addFeature(new ol.Feature({
    geometry: new ol.geom.LineString(coords.map(c => ol.proj.fromLonLat([c[0], c[1]]))), style, ...props}));
}

function draw() {
  routeSource.clear();
  const by = $('colorBy').value;
  for (const alt of state.results.nuovo?.alternatives ?? [])
    addLine(alt.geometry.coordinates, lineStyle('#8e44ad', 3, [4, 6]), {info: {title: `Alternativa: profilo ${alt.profile}`}});
  const prod = state.results.produzione;
  if (prod) addLine(prod.geometry.coordinates, lineStyle('#1f6feb', 3, [8, 6]), {info: {title: 'Produzione'}});
  const nuovo = state.results.nuovo;
  if (nuovo) {
    const c = nuovo.geometry.coordinates;
    const segs = nuovo.segments?.length ? nuovo.segments : [{from: 0, to: c.length - 1}];
    for (const seg of segs) {
      const styles = [lineStyle('#ffffff', 8), lineStyle(segColor(seg, by), 5)];
      if (seg.profile && seg.profile !== nuovo.profile) styles.push(lineStyle('#111111', 1.5, [4, 4]));
      addLine(c.slice(seg.from, seg.to + 1), styles, {seg});
    }
    if (state.highlight)
      addLine(c.slice(state.highlight.from, state.highlight.to + 1), lineStyle('rgba(255,214,0,0.85)', 12), {highlight: true});
  }
  for (const [name, r] of Object.entries(state.results))
    for (const c of r.connectors ?? [])
      addLine([c.from, c.to], lineStyle(name === 'nuovo' ? '#555555' : '#1f6feb', 2, [2, 4]),
        {info: {title: `Raccordo (${name === 'nuovo' ? 'motore nuovo' : 'produzione'}): ` +
          `${c.distanceM ?? ''}${c.distanceM !== undefined ? ' m ' : ''}in linea d'aria dal punto ${c.punto + 1} alla via`}});
  state.points.forEach((p, i) => routeSource.addFeature(new ol.Feature({
    geometry: new ol.geom.Point(ol.proj.fromLonLat(p)),
    style: [new ol.style.Style({
      image: new ol.style.Circle({radius: 10, fill: new ol.style.Fill({color: '#111'}),
                                  stroke: new ol.style.Stroke({color: '#fff', width: 2})}),
      text: new ol.style.Text({text: String(i + 1), fill: new ol.style.Fill({color: '#fff'}), font: 'bold 11px system-ui'}),
    }),
    // una tappa presa da un'icona delle tile porta il suo nome accanto al numero
    ...(state.poi[i] ? [new ol.style.Style({text: new ol.style.Text({text: state.poi[i].name, offsetX: 15,
      textAlign: 'left', font: 'bold 12px system-ui', fill: new ol.style.Fill({color: '#111'}),
      stroke: new ol.style.Stroke({color: '#fff', width: 3})})})] : []),
    ],
  })));
  drawPoints();
  drawResults();
  drawSegments();
  drawProfile();
}

function drawPoints() {
  const off = new Map(state.offTrail.map(x => [x.punto, x.distanceM]));
  // come sui cartelli dei sentieri: distanza e tempo DIN dalla partenza a ogni tappa
  const wp = new Map((state.results.nuovo?.waypoints ?? []).map(w => [w.punto, w]));
  const eta = i => {
    const w = wp.get(i);
    return w && i > 0 ? ` <small class="eta">${(w.distanceM / 1000).toFixed(1)} km · ${timeShort(w.timeH)}</small>` : '';
  };
  $('points').innerHTML = state.points.map((p, i) =>
    `<li><span class="num">${i + 1}</span><span class="pt">${state.poi[i] ? poiText(state.poi[i]) : `${p[0].toFixed(5)}, ${p[1].toFixed(5)}`}` +
    eta(i) + '</span>' +
    (off.has(i) ? ` <span class="off">a ${off.get(i)} m dal sentiero</span>` : '') +
    `<button data-i="${i}" title="Togli questo punto">×</button></li>`).join('');
  $('points').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    state.points.splice(Number(b.dataset.i), 1);
    state.poi.splice(Number(b.dataset.i), 1);
    recompute().catch(showError);
  }));
}

function lengthOn(r, pred) {
  const c = r.geometry.coordinates;
  if (c.length < 2 || !r.segments?.length) return null;
  return r.segments.filter(pred).reduce((a, s) => a + s.to - s.from, 0) / (c.length - 1);
}
const pct = x => (x === null || x === undefined ? 'n.d.' : `${Math.round(x * 100)}%`);
const timeShort = h => (h < 1 ? `${Math.round(h * 60)} min` : hours(h));
// difficolta' complessiva del giro: la massima dei tratti (linguaggio delle guide)
const DIFF_ORDER = ['T', 'E', 'EE', 'EEA', 'via ferrata', 'ghiacciaio'];
function overallDifficulty(r) {
  let top = null;
  for (const s of r.segments ?? [])
    if (s.difficulty && DIFF_ORDER.indexOf(s.difficulty) > DIFF_ORDER.indexOf(top)) top = s.difficulty;
  return top;
}
// quota minima e massima e tratto piu' ripido (almeno 30 m: sotto e' rumore del DEM)
function hikeStats(r) {
  const ele = r.geometry.coordinates.map(c => c[2]).filter(e => e !== undefined);
  const cum = cumulative(r.geometry.coordinates);
  let steep = null;
  for (const s of r.segments ?? []) {
    const len = cum[s.to] - cum[s.from];
    if (len >= 30 && Math.abs(s.slope ?? 0) > Math.abs(steep?.slope ?? 0))
      steep = {slope: s.slope, atM: cum[s.from], from: s.from, to: s.to};
  }
  return {minEle: ele.length ? Math.min(...ele) : null, maxEle: ele.length ? Math.max(...ele) : null, steep};
}
const hours = h => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`;

function card(title, color, r, extra = '') {
  const diff = r.segments?.length ? overallDifficulty(r) : null;
  const badge = diff ? ` <span class="badge" title="Difficoltà complessiva: la massima dei tratti" ` +
    `style="background:${segColor({difficulty: diff}, 'difficolta')}">${DIFF_SHORT[diff] ?? diff}</span>` : '';
  const st = r.segments?.length ? hikeStats(r) : null;
  return `<div class="card"><h3>${swatch({color, dash: color === '#1f6feb'})}${title}${badge}</h3><dl>
    <dt>Distanza</dt><dd>${(r.distanceM / 1000).toFixed(2)} km</dd>
    <dt>Salita / discesa</dt><dd>+${Math.round(r.ascendM ?? 0)} m / -${Math.round(r.descendM ?? 0)} m</dd>
    ${st?.maxEle !== null && st?.maxEle !== undefined ? `<dt title="Dalle quote del modello del terreno lungo il percorso">Quota</dt>
    <dd>${Math.round(st.minEle)}–${Math.round(st.maxEle)} m</dd>` : ''}
    ${st?.steep ? `<dt>Più ripido</dt><dd class="steep" data-from="${st.steep.from}" data-to="${st.steep.to}"
      title="Clicca per vederlo sulla mappa">${Math.round(Math.abs(st.steep.slope))}% al km ${(st.steep.atM / 1000).toFixed(1)}</dd>` : ''}
    <dt title="A piedi la regola DIN 33466: 4 km/h in piano, 300 m/h in salita, 500 m/h in discesa">Tempo</dt>
    <dd>${hours(r.timeH)} <small>(${r.timeSource})</small></dd>
    <dt title="Parte del percorso su sentieri della rete escursionistica (relazioni route=hiking)">Su sentieri segnati</dt>
    <dd>${pct(lengthOn(r, s => s.network && s.network !== 'missing'))}</dd>
    ${r.unknownShare !== undefined ? `<dt title="Sentieri senza cai_scale né sac_scale: la difficoltà non si conosce">Difficoltà sconosciuta</dt><dd>${pct(r.unknownShare)}</dd>` : ''}
    ${r.profileVersion ? `<dt>Profilo</dt><dd>${r.profile}, versione ${r.profileVersion}</dd>` : ''}
  </dl>${extra}</div>`;
}

const DIFF_SHORT = {T: 'T', E: 'E', EE: 'EE', EEA: 'EEA', 'via ferrata': 'ferrata', ghiacciaio: 'ghiacciaio'};
const ORIGIN_SHORT = {cai: 'cai_scale', sac: 'sac_scale', glacier: 'ghiacciaio', via_ferrata: 'via ferrata', none: 'sconosciuta'};
const diffLabel = s => (s.longChain ? 'sconosciuta (lunga)' : DIFF_SHORT[s.difficulty] ?? (s.roadClass && s.roadClass !== 'path' ? '—' : 'sconosciuta'));
const originLabel = s => (s.roadClass && s.roadClass !== 'path' && s.origin === 'none' ? 'strada' : ORIGIN_SHORT[s.origin] ?? s.origin ?? '—');
const slopeBucket = s => category(s, 'pendenza');

// Tratti contigui con la stessa difficolta', origine, tipo di via, segnaletica
// e profilo diventano una riga; fondo e sac_scale si mostrano come valore
// prevalente (per lunghezza), la pendenza come media.
function groupSegments(r) {
  const cum = cumulative(r.geometry.coordinates);
  const rows = [];
  const add = (m, k, len) => k && m.set(k, (m.get(k) ?? 0) + len);
  for (const s of r.segments ?? []) {
    const key = [diffLabel(s), originLabel(s), s.roadClass, s.network && s.network !== 'missing', s.profile, s.ref ?? ''].join('|');
    const len = cum[s.to] - cum[s.from];
    let last = rows.at(-1);
    if (!last || last.key !== key) {
      last = {key, seg: s, from: s.from, to: s.to, startM: cum[s.from], lenM: 0, slopeSum: 0,
              surfaces: new Map(), sacs: new Map(), ford: false, dismount: false};
      rows.push(last);
    }
    last.to = s.to; last.lenM += len; last.slopeSum += Math.abs(s.slope ?? 0) * len;
    add(last.surfaces, s.surface && s.surface !== 'missing' ? s.surface : null, len);
    add(last.sacs, s.sac, len);
    last.ford ||= s.ford; last.dismount ||= s.dismount;
  }
  const top = m => [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const x of rows) { x.surface = top(x.surfaces); x.sac = top(x.sacs); }
  return rows.filter(x => x.lenM >= 1 || rows.length === 1);
}

function summary(r) {
  const rows = groupSegments(r);
  const byDiff = new Map(), byOrigin = new Map(), byRef = new Map();
  let tot = 0;
  for (const x of rows) {
    tot += x.lenM;
    const d = diffLabel(x.seg), o = originLabel(x.seg);
    byDiff.set(d, (byDiff.get(d) ?? 0) + x.lenM);
    byOrigin.set(o, (byOrigin.get(o) ?? 0) + x.lenM);
    if (x.seg.ref) for (const ref of x.seg.ref.split(';')) byRef.set(ref, (byRef.get(ref) ?? 0) + x.lenM);
  }
  const fmt = m => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k === '—' ? 'strade' : k} ${(v / 1000).toFixed(1)} km`).join(', ');
  const fmtPct = m => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v / tot * 100)}%`).join(', ');
  const refs = [...byRef].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, v]) => `${k} ${(v / 1000).toFixed(1)} km`).join(', ');
  return `<div class="alt"><b>Per difficoltà</b>: ${fmt(byDiff)}<br><b>Origine del dato</b>: ${fmtPct(byOrigin)}` +
    `${refs ? `<br><b>Segnavia</b>: ${refs}` : ''}</div>`;
}

function drawSegments() {
  const r = state.results.nuovo;
  if (!r) { $('segments').innerHTML = ''; return; }
  const rows = groupSegments(r);
  const fb = rows.some(x => x.seg.profile && x.seg.profile !== r.profile);
  state.rows = rows;
  $('segments').innerHTML = `<thead><tr><th>km</th><th>Lungh.</th><th>Difficoltà</th><th>Origine</th><th>sac_scale</th>` +
    `<th>Tipo</th><th>Fondo</th><th>Pend.</th><th>Segnavia</th>${fb ? '<th>Profilo</th>' : ''}</tr></thead><tbody>` +
    rows.map((x, i) => {
      const s = x.seg, other = s.profile && s.profile !== r.profile;
      return `<tr data-i="${i}" class="${other ? 'fb' : ''}${state.highlight?.from === x.from ? ' sel' : ''}">` +
        `<td>${(x.startM / 1000).toFixed(2)}</td><td>${Math.round(x.lenM)} m</td>` +
        `<td><span class="tag" style="background:${segColor(s, 'difficolta')}"></span>${diffLabel(s)}</td>` +
        `<td><span class="tag" style="background:${segColor(s, 'origine')}"></span>${originLabel(s)}</td>` +
        `<td>${x.sac ?? '—'}</td><td>${ROAD_IT[s.roadClass] ?? s.roadClass ?? '—'}</td>` +
        `<td>${x.surface ? (SURFACE_IT[x.surface] ?? x.surface) : '—'}</td>` +
        `<td>${x.lenM ? Math.round(x.slopeSum / x.lenM) : 0}%</td>` +
        `<td>${s.ref ?? (s.network && s.network !== 'missing' ? 'sì' : '—')}${x.ford ? ', guado' : ''}${x.dismount ? ', bici a mano' : ''}</td>` +
        `${fb ? `<td>${s.profile ?? ''}</td>` : ''}</tr>`;
    }).join('') + '</tbody>';
  $('segments').querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => {
    const x = state.rows[Number(tr.dataset.i)];
    state.highlight = {from: x.from, to: x.to};
    draw();
    const c = r.geometry.coordinates.slice(x.from, x.to + 1).map(p => ol.proj.fromLonLat([p[0], p[1]]));
    if (mobile.matches && document.body.dataset.sheet === 'high') setSheet('mid');
    map.getView().fit(new ol.geom.LineString(c), {padding: fitPadding(80), maxZoom: 16, duration: 300});
  }));
}

function drawResults() {
  const {nuovo, produzione} = state.results;
  const parts = [];
  if (nuovo) {
    const alts = (nuovo.alternatives ?? []).map(a => `${a.profile}: ${(a.distanceM / 1000).toFixed(2)} km`);
    parts.push(card('Motore nuovo', '#d0021b', {...nuovo, timeSource: 'DIN 33466'}, summary(nuovo) +
      (alts.length ? `<div class="alt">Alternative con i profili accanto (in viola sulla mappa): ${alts.join(', ')}</div>` : '')));
  }
  if (produzione) parts.push(card(`Produzione (${PROD_HELP[$('prodProfile').value]})`, '#1f6feb', produzione));
  $('results').innerHTML = parts.length ? parts.join('') : '<p class="help">Metti almeno due punti sulla mappa.</p>';
  $('results').querySelectorAll('.steep').forEach(el => el.addEventListener('click', () => {
    state.highlight = {from: Number(el.dataset.from), to: Number(el.dataset.to)};
    draw();
    const c = state.results.nuovo.geometry.coordinates.slice(state.highlight.from, state.highlight.to + 1)
      .map(pt => ol.proj.fromLonLat([pt[0], pt[1]]));
    if (mobile.matches && document.body.dataset.sheet === 'high') setSheet('mid');
    map.getView().fit(new ol.geom.LineString(c), {padding: fitPadding(80), maxZoom: 16, duration: 300});
  }));
  drawMini();
  const warn = [];
  if (nuovo) warn.push(nuovo.warning);
  if (nuovo?.fallbackLegs?.length) {
    const byProfile = new Map();
    for (const l of nuovo.fallbackLegs) byProfile.set(l.profile, [...(byProfile.get(l.profile) ?? []), `${l.from + 1}-${l.to + 1}`]);
    warn.push(`Con il profilo ${nuovo.profile} non si arriva dappertutto: ` +
      [...byProfile].map(([p, legs]) => `i tratti ${legs.join(', ')} sono calcolati con ${p}`).join('; ') +
      ' (bordo tratteggiato sulla mappa, in viola nella tabella).');
  }
  if (nuovo?.snowWarning) warn.push('Il percorso supera i 2000 m: fra novembre e maggio la percorribilità dipende dalla neve.');
  if (state.offTrail.length)
    warn.push('Punti lontani dai sentieri, agganciati al più vicino: ' +
      state.offTrail.map(x => `${x.punto + 1} (${x.distanceM} m)`).join(', ') + '.');
  $('warning').textContent = warn.join(' ');
}

function cumulative(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1], [x2, y2] = coords[i];
    const k = Math.cos((y1 + y2) / 2 * Math.PI / 180);
    out.push(out[i - 1] + Math.hypot((x2 - x1) * k, y2 - y1) * 111320);
  }
  return out;
}

function drawProfile() {
  const cv = $('profile'), ctx = cv.getContext('2d');
  cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const W = cv.clientWidth, H = cv.clientHeight, L = 42, B = 18;
  ctx.clearRect(0, 0, W, H);
  const series = Object.entries(state.results)
    .map(([name, r]) => ({name, c: r.geometry.coordinates, d: cumulative(r.geometry.coordinates)}));
  if (!series.length) { $('elevation-axis').textContent = ''; return; }
  const ele = series.flatMap(s => s.c.map(p => p[2] ?? 0));
  const lo = Math.floor(Math.min(...ele) / 50) * 50, hi = Math.ceil(Math.max(lo + 50, ...ele) / 50) * 50;
  const maxD = Math.max(...series.map(s => s.d.at(-1)));
  const x = d => L + (d / maxD) * (W - L - 6), y = e => H - B - ((e - lo) / (hi - lo)) * (H - B - 6);
  ctx.strokeStyle = '#d8dde2'; ctx.fillStyle = '#5f6b76'; ctx.font = '10px system-ui';
  for (const e of [lo, (lo + hi) / 2, hi]) {
    ctx.beginPath(); ctx.moveTo(L, y(e)); ctx.lineTo(W - 6, y(e)); ctx.stroke();
    ctx.fillText(`${Math.round(e)} m`, 2, y(e) + 3);
  }
  for (const f of [0, 0.5, 1]) ctx.fillText(`${(maxD * f / 1000).toFixed(1)} km`, x(maxD * f) - (f === 1 ? 30 : f ? 14 : 0), H - 4);
  for (const s of series) {
    ctx.strokeStyle = s.name === 'nuovo' ? '#d0021b' : '#1f6feb'; ctx.lineWidth = 2;
    ctx.setLineDash(s.name === 'nuovo' ? [] : [6, 4]); ctx.beginPath();
    s.c.forEach((p, i) => (i ? ctx.lineTo(x(s.d[i]), y(p[2] ?? lo)) : ctx.moveTo(x(s.d[i]), y(p[2] ?? lo))));
    ctx.stroke(); ctx.setLineDash([]);
  }
  $('elevation-axis').innerHTML = 'Asse verticale: quota in metri; orizzontale: distanza dalla partenza.<br>' +
    series.map(s => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:12px">` +
      `${swatch({color: s.name === 'nuovo' ? '#d0021b' : '#1f6feb', dash: s.name !== 'nuovo'})}` +
      `${s.name === 'nuovo' ? 'motore nuovo' : 'produzione'}</span>`).join('');
}

// --- dettagli al passaggio del mouse ---------------------------------------

const SURFACE_IT = {asphalt: 'asfalto', paved: 'pavimentato', concrete: 'cemento', paving_stones: 'lastricato',
  sett: 'selciato', cobblestone: 'acciottolato', compacted: 'sterrato compatto', gravel: 'ghiaia', fine_gravel: 'ghiaino',
  unpaved: 'sterrato', dirt: 'terra', ground: 'terreno', grass: 'erba', rock: 'roccia', sand: 'sabbia', wood: 'legno'};
const NETWORK_IT = {local: 'rete locale', regional: 'rete regionale', national: 'rete nazionale',
  international: 'rete internazionale'};
const ROAD_IT = {path: 'sentiero', track: 'forestale', footway: 'percorso pedonale', steps: 'scalini',
  residential: 'strada residenziale', unclassified: 'strada locale', tertiary: 'strada terziaria',
  secondary: 'strada secondaria', primary: 'strada principale', service: 'strada di servizio', cycleway: 'ciclabile',
  bridleway: 'ippovia', pedestrian: 'zona pedonale', living_street: 'zona residenziale'};
const DIFF_TEXT = {T: 'T (turistico)', E: 'E (escursionistico)', EE: 'EE (escursionisti esperti)',
  EEA: 'EEA (con attrezzatura)', 'via ferrata': 'via ferrata', ghiacciaio: 'ghiacciaio'};
const ORIGIN_TEXT = {cai: 'dalla scala CAI della relazione', sac: 'da sac_scale della via', none: 'nessun dato',
  glacier: 'dentro un ghiacciaio', via_ferrata: 'via ferrata'};

const featureAt = (pixel, tol) =>
  map.forEachFeatureAtPixel(pixel, f => (f.get('seg') || f.get('info') ? f : undefined), {hitTolerance: tol});

map.on('pointermove', e => {
  if (touch.matches) return;          // sul telefono i dettagli arrivano al tocco
  const tip = $('tooltip');
  const f = featureAt(e.pixel, 4);
  map.getTargetElement().style.cursor = f ? 'pointer' : '';
  if (!f) {
    const poi = rejoinOn ? null : findPoi(e.pixel);
    map.getTargetElement().style.cursor = poi ? 'pointer' : '';
    if (!poi) { tip.style.display = 'none'; return; }
    tip.innerHTML = `<b>${poiText(poi)}</b>Clicca per usarlo come tappa del giro`;
    tip.style.display = 'block';
    tip.style.left = `${e.pixel[0] + 14}px`; tip.style.top = `${e.pixel[1] + 14}px`;
    return;
  }
  tip.innerHTML = tipHtml(f);
  tip.style.display = 'block';
  tip.style.left = `${e.pixel[0] + 14}px`; tip.style.top = `${e.pixel[1] + 14}px`;
});

function tipHtml(f) {
  const seg = f.get('seg');
  const road = seg?.roadClass && seg.roadClass !== 'path';
  return seg
    ? `<b>Motore nuovo</b>Difficoltà: ${DIFF_TEXT[seg.difficulty] ?? (road ? 'nessuna (strada o forestale)' : 'sconosciuta')}` +
      `${seg.difficulty ? ` (${ORIGIN_TEXT[seg.origin] ?? seg.origin})` : ''}${seg.longChain ? ', tratto sconosciuto lungo' : ''}<br>` +
      (seg.sac ? `sac_scale originale: ${seg.sac}<br>` : '') +
      `Segnato: ${seg.network && seg.network !== 'missing' ? 'sì, ' + (NETWORK_IT[seg.network] ?? seg.network) : 'no'}` +
      `${seg.ref ? ` · segnavia ${seg.ref.replaceAll(';', ', ')}` : ''}<br>` +
      `Tipo: ${ROAD_IT[seg.roadClass] ?? seg.roadClass ?? 'n.d.'} · fondo: ` +
      `${seg.surface && seg.surface !== 'missing' ? (SURFACE_IT[seg.surface] ?? seg.surface) : 'non indicato'}<br>` +
      `Pendenza media: ${seg.slope ?? 0}%${seg.ford ? '<br>Guado' : ''}${seg.dismount ? '<br>Bici a mano' : ''}` +
      (seg.profile && seg.profile !== state.results.nuovo?.profile ? `<br><b>Calcolato con il profilo ${seg.profile}</b>` : '')
    : `<b>${f.get('info').title}</b>`;
}

// Sul telefono un tocco su un tratto apre i suoi dettagli invece di aggiungere un
// punto: chi vuole un punto proprio li' lo aggiunge dal pulsante.
function pinTip(f, coord) {
  const tip = $('tooltip');
  tip.innerHTML = tipHtml(f) + '<div class="actions"><button data-a="add">Aggiungi un punto qui</button>' +
    '<button data-a="close">Chiudi</button></div>';
  tip.classList.add('pinned');
  tip.style.display = 'block';
  tip.querySelector('[data-a=add]').addEventListener('click', () => { closeTip(); addPoint(coord, null); });
  tip.querySelector('[data-a=close]').addEventListener('click', closeTip);
}
function closeTip() {
  const tip = $('tooltip');
  tip.classList.remove('pinned');
  tip.style.display = 'none';
}

// --- punti di interesse delle tile ------------------------------------------

// I livelli puntuali delle tile di wm-tiles che possono diventare tappe. Le
// localita' vengono per ultime: un nome di luogo e' meno preciso di una cima.
const POI_LAYERS = ['rifugi', 'osmpoi', 'mountain_peak', 'poi'];
const KIND_IT = {peak: 'cima', saddle: 'valico', mountain_pass: 'valico', spring: 'sorgente', alpine_hut: 'rifugio',
  wilderness_hut: 'bivacco', shelter: 'riparo', cave_entrance: 'grotta', viewpoint: 'punto panoramico',
  drinking_water: 'fontana', locality: 'località', volcano: 'vulcano', waterfall: 'cascata', hut: 'rifugio'};
function findPoi(pixel) {
  const found = [];
  map.forEachFeatureAtPixel(pixel, f => {
    if (f.getType?.() !== 'Point' || !POI_LAYERS.includes(f.get('layer')) || !f.get('name')) return;
    found.push(f);
  }, {hitTolerance: 6, layerFilter: l => l !== routeLayer});
  if (!found.length) return null;
  found.sort((a, b) => (a.get('kind') === 'locality') - (b.get('kind') === 'locality'));
  const f = found[0];
  const flat = f.getFlatCoordinates ? f.getFlatCoordinates() : f.getGeometry().getCoordinates();
  return {name: f.get('name'), kind: KIND_IT[f.get('kind') ?? f.get('class')] ?? f.get('kind') ?? f.get('class') ?? '',
          ele: f.get('ele') ?? null, coord: ol.proj.toLonLat([flat[0], flat[1]])};
}
const poiText = p => `${p.name}${p.kind ? ' · ' + p.kind : ''}${p.ele ? ' · ' + p.ele + ' m' : ''}`;

// --- calcolo ---------------------------------------------------------------

async function recompute() {
  showError('');
  state.results = {};
  state.offTrail = [];
  state.highlight = null;
  $('rejoin-result').textContent = '';
  syncUrl();
  if (state.points.length < 2) return draw();
  state.loading = true;
  drawMini();
  const mode = engineMode();
  const jobs = [];
  if (mode !== 'produzione')
    jobs.push(routeNew().then(r => { state.results.nuovo = r; state.offTrail = r.offTrailPoints ?? []; }));
  if (mode !== 'nuovo') jobs.push(routeProd().then(r => { state.results.produzione = r; }));
  const out = await Promise.allSettled(jobs);
  const errs = out.filter(o => o.status === 'rejected').map(o => o.reason?.message ?? o.reason);
  state.loading = false;
  if (errs.length) showError(errs.join('\n'));
  draw();
}

// --- rientro ---------------------------------------------------------------

let rejoinOn = false;
$('rejoinMode').addEventListener('click', () => {
  rejoinOn = !rejoinOn;
  $('rejoinMode').classList.toggle('on', rejoinOn);
  $('rejoinMode').textContent = rejoinOn ? 'Simulazione attiva: clicca dove si trova la persona' : 'Attiva la simulazione';
  if (rejoinOn && mobile.matches) setSheet('low');
  drawMini();
});

async function rejoin(position) {
  const base = state.results.nuovo;
  if (!base) return showError('Per simulare il rientro calcola prima un tracciato con il motore nuovo.');
  const track = base.geometry.coordinates.map(c => [c[0], c[1]]);
  state.rejoinLoading = true;
  $('rejoin-result').textContent = 'Calcolo del rientro…';
  drawMini();
  const r = await fetch(`/v1/${SHARD}/rejoin`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: $('newProfile').value, position, track, progressM: Number($('progress').value),
                          direction: $('direction').value, matchTrack: true})});
  const j = await r.json().finally(() => { state.rejoinLoading = false; drawMini(); });
  routeSource.addFeature(new ol.Feature({geometry: new ol.geom.Point(ol.proj.fromLonLat(position)),
    style: new ol.style.Style({image: new ol.style.Circle({radius: 7, fill: new ol.style.Fill({color: '#00c853'}),
      stroke: new ol.style.Stroke({color: '#fff', width: 2})})})}));
  if (j.stato !== 'rientro') { $('rejoin-result').textContent = explain(j); showRejoin(); return; }
  // il primo tratto, se e' fuori sentiero, va dalla persona alla via: punteggiato
  const drawFromPerson = (route, color, title) => {
    const c = route.geometry.coordinates;
    const offTrail = route.segments?.[0]?.offTrail;
    if (offTrail) addLine(c.slice(0, 2), lineStyle(color, 3, [2, 5]), {info: {title: `${title}: tratto fuori sentiero, in linea d'aria`}});
    addLine(offTrail ? c.slice(1) : c, lineStyle(color, 4), {info: {title}});
  };
  drawFromPerson(j.route, '#00c853', 'Rientro sulla traccia');
  if (j.backToReached) drawFromPerson(j.backToReached, '#00b8d4', 'Ritorno al punto già raggiunto');
  $('rejoin-result').textContent = `Rientro: ${(j.route.distanceM / 1000).toFixed(2)} km, ricongiunge la traccia ` +
    `a ${(j.joinAtM / 1000).toFixed(2)} km dalla partenza` +
    (j.offPathM ? `; il primo tratto, ${Math.round(j.offPathM)} m, è fuori sentiero (in linea d'aria)` : '') +
    (j.backToReached ? `. In azzurro il ritorno al punto già raggiunto: ${(j.backToReached.distanceM / 1000).toFixed(2)} km, molto più corto.` : '.');
  showRejoin();
}
// sul telefono l'esito sta nella scheda del rientro: la si apre a meta' schermo
function showRejoin() {
  if (!mobile.matches) return;
  setTab('rientro');
  if (document.body.dataset.sheet === 'low') setSheet('mid');
}

// --- eventi ----------------------------------------------------------------

function addPoint(p, poi) {
  state.points.push(poi ? poi.coord : p);
  state.poi[state.points.length - 1] = poi;
  // sul telefono il nome della tappa sta in una scheda chiusa: lo si conferma nel riepilogo
  if (poi) flash(`Punto ${state.points.length}: ${poiText(poi)}`);
  recompute().catch(showError);
}
let flashTimer;
function flash(text) {
  state.flash = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { state.flash = null; drawMini(); }, 4000);
  drawMini();
}
map.on('singleclick', e => {
  const p = ol.proj.toLonLat(e.coordinate);
  if (rejoinOn) return rejoin(p).catch(showError);
  const pinned = $('tooltip').classList.contains('pinned');
  closeTip();
  if (pinned) return;                 // il primo tocco chiude i dettagli aperti
  // un clic su un punto di interesse delle tile prende le sue coordinate esatte e il
  // suo nome, anche vicino al percorso: l'icona e' un bersaglio piu' preciso del tratto
  const poi = findPoi(e.pixel);
  if (!poi && touch.matches) {
    const f = featureAt(e.pixel, 10);
    if (f) return pinTip(f, p);
  }
  addPoint(p, poi);
});
document.querySelectorAll('input[name=engine]').forEach(r => r.addEventListener('change', () => {
  $('engine-help').textContent = ENGINE_HELP[engineMode()];
  recompute().catch(showError);
}));
$('newProfile').addEventListener('change', () => {
  $('profile-help').textContent = PROFILE_HELP[$('newProfile').value] ?? '';
  recompute().catch(showError);
});
for (const id of ['prodProfile', 'maxRating', 'maxSlope', 'excludeUnknown'])
  $(id).addEventListener('change', () => recompute().catch(showError));
$('colorBy').addEventListener('change', () => { syncUrl(); drawLegends(); draw(); });
for (const id of ['direction', 'progress']) $(id).addEventListener('change', syncUrl);
$('clear').addEventListener('click', () => { state.points = []; state.poi = []; recompute().catch(showError); });
$('undo').addEventListener('click', () => { state.points.pop(); state.poi.length = state.points.length; recompute().catch(showError); });
map.on('moveend', syncUrl);

async function loadMeta() {
  const [list, stamp] = await Promise.all([
    fetch(`/v1/${SHARD}/profiles`).then(r => r.json()),
    fetch('/v1/version').then(r => r.json()),
  ]);
  $('newProfile').innerHTML = list.map(p => `<option value="${p.name}">${p.name} · v${p.version}</option>`).join('');
  $('newProfile').value = q.get('profilo') ?? 'escursionista';
  $('profile-help').textContent = PROFILE_HELP[$('newProfile').value] ?? '';
  $('engine-help').textContent = ENGINE_HELP[engineMode()];
  $('stamp').textContent = `Dati OpenStreetMap del ${stamp.osm?.slice(0, 10) ?? 'n.d.'} · ` +
    `grafo costruito il ${stamp.builtAt?.slice(0, 10) ?? 'n.d.'}`;
  drawArea(stamp.area);
}

drawLegends();
setTab(state.points.length >= 2 ? 'percorso' : 'punti');
setSheet('low');
// sul telefono si inquadra il percorso solo se l'indirizzo non dice gia' dove
// guardare: una pagina ricaricata riparte dalla vista in cui era
loadMeta().then(recompute).then(() => { if (mobile.matches && state.points.length >= 2 && !q.get('c')) fitRoute(); })
  .catch(showError);

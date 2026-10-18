// Scheda stampabile del giro: chiede i dati a /g/scheda.json con lo stesso
// blob firmato della pagina e li disegna. Nessuna libreria: si salva in PDF
// dal browser (Stampa). Mappa e profilo si disegnano come nella preview.
import {disegnaProfilo} from './profilo-disegno.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const NOMI_PROFILO = {
  prudente: 'Escursionista prudente', escursionista: 'Escursionista', esperto: 'Escursionista esperto',
  alpinista: 'Alpinista', mtb: 'Mountain bike', libero: 'Libero',
};
const TIPI_POI = {
  peak: 'cima', saddle: 'sella', spring: 'sorgente', drinking_water: 'acqua potabile',
  alpine_hut: 'rifugio', wilderness_hut: 'bivacco', viewpoint: 'punto panoramico',
  shelter: 'riparo', cave_entrance: 'grotta', information: 'informazioni',
};

const fmt = (n, d = 1) => Number(n).toLocaleString('it-IT', {minimumFractionDigits: d, maximumFractionDigits: d});
const ore = h => {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};
const dataIt = s => {
  const d = new Date(s);
  return isNaN(d) ? esc(s) : d.toLocaleDateString('it-IT', {day: 'numeric', month: 'long', year: 'numeric'});
};

// Sulla carta il lettore vuole una riga per sentiero: si sommano i tratti con lo stesso
// numero e la stessa difficolta' (il tipo di fondo qui non si vede), e i pezzi sotto
// i 200 m finiscono in una riga unica in fondo.
const SOGLIA_KM = 0.2;
function righeSentieri(lista) {
  const gruppi = new Map();
  for (const s of lista) {
    const ref = s.ref && s.ref !== '(senza ref)' ? s.ref : 'senza numero';
    // «senza numero» non e' l'identita' di un sentiero ma la sua assenza: spezzarla per
    // difficolta' darebbe due righe apparentemente uguali, quindi e' un gruppo solo.
    const k = ref === 'senza numero' ? ref : `${ref}|${s.difficolta ?? ''}`;
    const g = gruppi.get(k) ?? {ref, difficolta: s.difficolta ?? null, km: 0};
    if (g.km && g.difficolta !== (s.difficolta ?? null)) g.difficolta = null;   // difficolta' miste: non si dice
    g.km += s.km;
    gruppi.set(k, g);
  }
  const tutti = [...gruppi.values()].sort((a, b) => b.km - a.km);
  const righe = tutti.filter(g => g.km >= SOGLIA_KM);
  const brevi = tutti.filter(g => g.km < SOGLIA_KM);
  if (brevi.length) righe.push({ref: 'altri tratti brevi', difficolta: null, km: brevi.reduce((t, g) => t + g.km, 0)});
  return righe;
}

function render(d) {
  const cambiati = d.stampCorrente && d.stamp && d.stampCorrente !== d.stamp;
  const tappe = d.tappe.map((t, i) => `<tr><td>${i === 0 ? 'Partenza' : i === d.tappe.length - 1 ? 'Arrivo' : `Tappa ${i}`}</td>` +
    `<td class="num">${fmt(t.kmDallaPartenza, 2)} km</td><td class="num">${ore(t.oreDallaPartenza)}</td></tr>`).join('');
  const sentieri = righeSentieri(d.sentieri).map(s => `<tr><td>${esc(s.ref)}</td><td>${esc(s.difficolta ?? '—')}</td>` +
    `<td class="num">${fmt(s.km, 2)} km</td></tr>`).join('');
  let poi = '';
  if (d.poiNonDisponibili) {
    poi = '<p class="avviso">L’elenco dei punti di interesse non è disponibile in questo momento: riapri la scheda tra poco.</p>';
  } else if (d.poi.length) {
    poi = `<table><thead><tr><th>Luogo</th><th>Quota</th><th>Nota dell’assistente</th></tr></thead><tbody>` +
      d.poi.map(p => `<tr><td><strong>${esc(p.name)}</strong>${TIPI_POI[p.kind] ? `<br><span class="tipo">${esc(TIPI_POI[p.kind])}</span>` : ''}</td>` +
        `<td class="num">${p.ele != null ? `${fmt(p.ele, 0)} m` : '—'}</td><td>${esc(p.nota ?? '')}</td></tr>`).join('') +
      '</tbody></table>';
    if (d.poiMancanti) poi += `<p class="avviso">${d.poiMancanti === 1 ? 'Un punto scelto non è più presente' : `${d.poiMancanti} punti scelti non sono più presenti`} nei dati.</p>`;
  } else if (d.poiMancanti) {
    poi = '<p class="avviso">I punti di interesse scelti non sono più presenti nei dati.</p>';
  }
  $('scheda').innerHTML = `
    <header>
      <h1>Scheda del giro</h1>
      <p class="sotto">${esc(NOMI_PROFILO[d.profilo] ?? d.profilo)} · dati del ${dataIt(d.stamp)}</p>
      <button type="button" id="stampa" class="no-print">Stampa o salva in PDF</button>
    </header>
    ${cambiati ? '<p class="avviso">I dati sono cambiati da quando questo giro è stato progettato: ricontrolla tempi e difficoltà.</p>' : ''}
    <section class="giro">
      <h2>Il percorso</h2>
      <div id="mappa" role="img" aria-label="Mappa del giro"></div>
      <p class="didascalia">Verde la partenza, rosso l’arrivo${d.poi.length ? ', blu i luoghi lungo il giro' : ''}.</p>
      <h2>Profilo altimetrico</h2>
      <canvas id="profilo" role="img" aria-label="Profilo altimetrico del giro"></canvas>
      <p class="didascalia">Quota in metri, distanza dalla partenza in chilometri.</p>
    </section>
    <section>
      <h2>I numeri</h2>
      <table class="numeri"><tbody>
        <tr><th>Distanza</th><td class="num">${fmt(d.distanzaKm, 2)} km</td></tr>
        <tr><th>Salita</th><td class="num">${fmt(d.salitaM, 0)} m</td></tr>
        <tr><th>Discesa</th><td class="num">${fmt(d.discesaM, 0)} m</td></tr>
        <tr><th>Tempo di cammino</th><td class="num">${ore(d.oreDIN33466)}</td></tr>
        ${d.quotaMinMaxM ? `<tr><th>Quota minima e massima</th><td class="num">${fmt(d.quotaMinMaxM[0], 0)} – ${fmt(d.quotaMinMaxM[1], 0)} m</td></tr>` : ''}
      </tbody></table>
    </section>
    ${tappe ? `<section><h2>Tappe</h2><table><thead><tr><th>Punto</th><th>Km dalla partenza</th><th>Tempo</th></tr></thead><tbody>${tappe}</tbody></table></section>` : ''}
    ${sentieri ? `<section><h2>Sentieri</h2><table id="sentieri"><thead><tr><th>Numero</th><th>Difficoltà</th><th>Lunghezza</th></tr></thead><tbody>${sentieri}</tbody></table></section>` : ''}
    ${poi ? `<section><h2>Luoghi lungo il giro</h2>${poi}</section>` : ''}
    <footer>
      <p>${esc(d.avvertenza)}</p>
      <p>Punti di interesse: OpenStreetMap, dati del ${dataIt(d.stamp)}.</p>
      ${d.poi.some(p => p.nota) ? '<p>Le note sono scritte dall’assistente, non da Webmapp.</p>' : ''}
    </footer>`;
  $('stampa').addEventListener('click', () => window.print());
  disegnaMappa(d);
  const profilo = () => disegnaProfilo($('profilo'), [{c: d.geometry.coordinates, colore: '#d0021b'}]);
  profilo();
  // in stampa la larghezza cambia: il profilo si ridisegna alla misura della pagina
  window.addEventListener('beforeprint', () => { profilo(); window.__schedaMappa?.updateSize(); });
  window.addEventListener('afterprint', () => { profilo(); window.__schedaMappa?.updateSize(); });
  window.addEventListener('resize', profilo);
  document.title = `Scheda del giro, ${fmt(d.distanzaKm, 1)} km`;
}

function marcatore(lonLat, colore, nome, raggio = 7) {
  const f = new ol.Feature(new ol.geom.Point(ol.proj.fromLonLat(lonLat)));
  f.setStyle(new ol.style.Style({
    image: new ol.style.Circle({radius: raggio, fill: new ol.style.Fill({color: colore}),
      stroke: new ol.style.Stroke({color: '#fff', width: 2})}),
    text: nome ? new ol.style.Text({text: nome, offsetX: 11, textAlign: 'left', font: 'bold 12px system-ui',
      fill: new ol.style.Fill({color: '#111'}), stroke: new ol.style.Stroke({color: '#fff', width: 3})}) : undefined,
  }));
  return f;
}

// Stesso stile e stessa libreria della preview.
function disegnaMappa(d) {
  const coords = d.geometry.coordinates.map(c => ol.proj.fromLonLat([c[0], c[1]]));
  const linea = new ol.Feature(new ol.geom.LineString(coords));
  linea.setStyle([
    new ol.style.Style({stroke: new ol.style.Stroke({color: '#fff', width: 7})}),
    new ol.style.Style({stroke: new ol.style.Stroke({color: '#d0021b', width: 4})}),
  ]);
  const ll = d.geometry.coordinates;
  const feats = [linea, marcatore(ll.at(-1), '#d0021b', null, 10), marcatore(ll[0], '#1b8a3a', null, 5),
    ...d.poi.map(p => marcatore(p.lonLat, '#1f6feb', p.name))];
  const giro = new ol.layer.Vector({zIndex: 10, source: new ol.source.Vector({features: feats})});
  giro.set('giro', true);
  const map = new ol.Map({target: 'mappa', controls: [], interactions: [], view: new ol.View({center: coords[0], zoom: 12})});
  window.__schedaMappa = map;
  map.addLayer(giro);
  // l'inquadratura comprende anche i luoghi, con spazio per le loro etichette
  map.getView().fit(giro.getSource().getExtent(), {padding: [30, 120, 30, 40], maxZoom: 16});
  // lo sfondo e' lo stile della preview; senza, la scheda resta leggibile col solo tracciato
  const sopra = () => { if (!map.getLayers().getArray().includes(giro)) map.addLayer(giro); };
  olms.apply(map, 'https://tiles.maphub.it/style.json').then(sopra).catch(sopra);
}

async function main() {
  try {
    // documento salvato su disco: i dati sono gia' scritti nel blocco e non c'e' nulla da chiamare.
    // Il modulo gira dopo il parsing, quindi il blocco e' gia' nel DOM.
    const inline = (document.getElementById('dati-giro')?.textContent ?? '').trim();
    if (inline) {
      render(JSON.parse(inline)); // un file alterato cade nel catch: stesso avviso, nessuna ipotesi
      return;
    }
    const r = await fetch('/g/scheda.json' + location.search, {referrerPolicy: 'no-referrer'});
    if (!r.ok) throw new Error();
    render(await r.json());
  } catch {
    $('scheda').innerHTML = '<p class="avviso">Non riesco a preparare la scheda in questo momento. Riprova tra poco o fatti rimandare il link.</p>';
  }
}
main();

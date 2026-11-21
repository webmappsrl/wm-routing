// Controllo prima dello scambio: i percorsi di prova devono stare nel
// rettangolo del grafo e riuscire sul grafo nuovo con quote vere, e i nodi non
// devono calare di oltre il 5% rispetto al grafo in uso. Guarda anche il dato
// del pre-passo (prepare.json), che puo' mancare mentre il grafo resta valido.
// Uso: node tools/gate.mjs <url motore nuovo> <stamp nuovo> <stamp in uso> <prepare.json nuovo> <prepare.json in uso>
// Gli argomenti sono posizionali e vanno passati tutti; i due "in uso" possono
// essere percorsi di file che non esistono (primo build), e allora non si confronta.
import {readFileSync, existsSync} from 'node:fs';
import {compareData} from './gate-data.mjs';

const [url, stampNew, stampOld, prepNew, prepOld] = process.argv.slice(2);
const [w, s, e, n] = (process.env.WM_GRAPH_BBOX ?? '').split(',').map(Number);
if (![w, s, e, n].every(Number.isFinite)) { console.error('!! serve WM_GRAPH_BBOX (tools/bbox.sh)'); process.exit(3); }
const inside = ([x, y]) => x >= w && x <= e && y >= s && y <= n;
const routes = JSON.parse(readFileSync('compare/routes.json', 'utf8')).filter(r => r.points.every(inside));
if (!routes.length) { console.error('!! nessun percorso di prova nel rettangolo del grafo: rigenera compare/routes.json'); process.exit(3); }
const fails = [];
for (const r of routes) {
  const res = await fetch(`${url}/route`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({profile: 'escursionista', points: r.points, points_encoded: false,
                          instructions: false, elevation: true})});
  if (!res.ok) { fails.push(`${r.id} (nessun percorso)`); continue; }
  const ele = (await res.json()).paths[0].points.coordinates.map(c => c[2]);
  const zeros = ele.filter(z => !Number.isFinite(z) || z === 0).length;
  // una quota mancante GraphHopper la mette a 0 in silenzio (OSMReader.java:186)
  if (zeros / ele.length > 0.05) fails.push(`${r.id} (quote a zero: ${zeros}/${ele.length})`);
}
const nodesNew = JSON.parse(readFileSync(stampNew, 'utf8')).nodes;
const nodesOld = stampOld && existsSync(stampOld) ? JSON.parse(readFileSync(stampOld, 'utf8')).nodes : null;
const drop = nodesOld ? (nodesOld - nodesNew) / nodesOld : 0;
if (fails.length || !nodesNew || drop > 0.05) {
  console.error(`!! scambio bloccato: ${fails.join(', ') || 'percorsi ok'}; nodi ${nodesNew} contro ${nodesOld}`);
  process.exit(3);
}
// il riassunto del pre-passo in uso puo' non esserci (primo build) o non leggersi: allora basta che il nuovo sia pieno
if (!prepNew || !existsSync(prepNew)) { console.error('!! scambio bloccato: manca il riassunto del pre-passo del grafo nuovo'); process.exit(3); }
let dataNew;
try { dataNew = JSON.parse(readFileSync(prepNew, 'utf8')); }
catch { console.error('!! scambio bloccato: il riassunto del pre-passo del grafo nuovo non si legge'); process.exit(3); }
let dataOld;
try { dataOld = prepOld && existsSync(prepOld) ? JSON.parse(readFileSync(prepOld, 'utf8')) : undefined; }
catch { console.error('!! riassunto del pre-passo in uso illeggibile: lo si tratta come assente'); }
const verdict = compareData(dataNew, dataOld);
if (!verdict.ok) { console.error(`!! scambio bloccato: dato del pre-passo monco: ${verdict.reason}`); process.exit(3); }
console.log(`controllo superato: ${routes.length} percorsi, nodi ${nodesNew}`);

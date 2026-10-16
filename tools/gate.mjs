// Controllo prima dello scambio: i percorsi di prova devono stare nel
// rettangolo del grafo e riuscire sul grafo nuovo con quote vere, e i nodi non
// devono calare di oltre il 5% rispetto al grafo in uso.
// Uso: node tools/gate.mjs <url motore nuovo> <stamp nuovo> [stamp in uso]
import {readFileSync, existsSync} from 'node:fs';

const [url, stampNew, stampOld] = process.argv.slice(2);
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
console.log(`controllo superato: ${routes.length} percorsi, nodi ${nodesNew}`);

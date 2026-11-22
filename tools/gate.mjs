// Controllo prima dello scambio: i percorsi di prova devono stare nel
// rettangolo del grafo e riuscire sul grafo nuovo con quote vere, e i nodi non
// devono calare di oltre il 5% rispetto al grafo in uso. Guarda anche il dato
// del pre-passo (prepare.json), che puo' mancare mentre il grafo resta valido.
// Uso: node tools/gate.mjs <url motore nuovo> <stamp nuovo> <stamp in uso> <prepare.json nuovo> <prepare.json in uso>
// Gli argomenti sono posizionali e vanno passati tutti; i due "in uso" possono
// essere percorsi di file che non esistono (primo build), e allora non si confronta.
import {existsSync} from 'node:fs';
import {compareData, describeAreas} from './gate-data.mjs';
import {readJsonFile} from './json-file.mjs';

// Un file che il gate non sa leggere e' un gate che non sa dire di si': si
// blocca con 3, come per il dato monco, e si dice quale file e perche'.
function mustRead(path) {
  const r = readJsonFile(path);
  if (!r.ok) { console.error(`!! scambio bloccato: ${r.reason}`); process.exit(3); }
  return r.value;
}

const [url, stampNew, stampOld, prepNew, prepOld] = process.argv.slice(2);
const [w, s, e, n] = (process.env.WM_GRAPH_BBOX ?? '').split(',').map(Number);
if (![w, s, e, n].every(Number.isFinite)) { console.error('!! serve WM_GRAPH_BBOX (tools/bbox.sh)'); process.exit(3); }
const inside = ([x, y]) => x >= w && x <= e && y >= s && y <= n;
const routes = mustRead('compare/routes.json').filter(r => r.points.every(inside));
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
const nodesNew = mustRead(stampNew).nodes;
// lo stamp in uso manca al primo build; se c'e' ma non si legge, il gate si
// ferma: un confronto saltato in silenzio e' il modo in cui un calo passa
const nodesOld = stampOld && existsSync(stampOld) ? mustRead(stampOld).nodes : null;
const drop = nodesOld ? (nodesOld - nodesNew) / nodesOld : 0;
if (fails.length || !nodesNew || drop > 0.05) {
  console.error(`!! scambio bloccato: ${fails.join(', ') || 'percorsi ok'}; nodi ${nodesNew} contro ${nodesOld}`);
  process.exit(3);
}
// il riassunto del pre-passo in uso puo' non esserci (primo build) o non leggersi: allora basta che il nuovo sia pieno
if (!prepNew || !existsSync(prepNew)) { console.error('!! scambio bloccato: manca il riassunto del pre-passo del grafo nuovo'); process.exit(3); }
const dataNew = mustRead(prepNew);
let dataOld;
if (prepOld && existsSync(prepOld)) {
  const r = readJsonFile(prepOld);
  if (r.ok) dataOld = r.value;
  else console.error(`!! riassunto del pre-passo in uso illeggibile, lo si tratta come assente: ${r.reason}`);
}
// WM_ACCEPT_DROP: chiavi separate da virgola il cui calo e' voluto in questo
// build (es. WM_ACCEPT_DROP=areas_built.region quando cambia il criterio con
// cui si riconosce una regione). Vale per il singolo build, non si scrive in
// nessun file: il prossimo riparte col gate pieno.
const accept = (process.env.WM_ACCEPT_DROP ?? '').split(',').map(k => k.trim()).filter(Boolean);
if (accept.length) console.error(`!! cali dichiarati per questo build: ${accept.join(', ')}`);
const verdict = compareData(dataNew, dataOld, {accept});
if (!verdict.ok) { console.error(`!! scambio bloccato: dato del pre-passo monco: ${verdict.reason}`); process.exit(3); }
console.log(`controllo superato: ${routes.length} percorsi, nodi ${nodesNew}`);
console.log(describeAreas(dataNew));

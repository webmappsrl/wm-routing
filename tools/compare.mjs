// Confronto con il GraphHopper di produzione: stessi punti, due motori. Ogni
// differenza oltre soglia va classificata in compare/verdicts.json come
// "voluta" o "difetto", con il motivo; esce 1 se ne resta una senza verdetto.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';

const NEW = process.env.WM_GATEWAY ?? 'http://127.0.0.1:8991/v1/preview/route';
const PROD = process.env.WM_PROD ?? 'https://graphhopper.webmapp.it/route';
const THRESHOLDS = {distance: 0.15, ascend: 0.2, network: 0.15};

const rel = (a, b) => Math.abs(a - b) / Math.max(a, b, 1);
export function classify(a, b, t) {
  const out = [];
  if (rel(a.distanceM, b.distanceM) > t.distance) out.push('distanza');
  if (rel(a.ascendM, b.ascendM) > t.ascend) out.push('salita');
  if (Math.abs(a.networkShare - b.networkShare) > t.network) out.push('rete');
  return out;
}

function share(segments, coordsLen, isNetwork) {
  if (coordsLen < 2) return 0;
  let on = 0;
  for (const s of segments) if (isNetwork(s)) on += s.to - s.from;
  return on / (coordsLen - 1);
}

async function post(url, body) {
  const r = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  return {ok: r.ok, json: await r.json().catch(() => ({}))};
}

async function main() {
  const i = process.argv.indexOf('--giro');
  const giro = i > 0 ? process.argv[i + 1] : 'ultimo';
  const routes = JSON.parse(readFileSync('compare/routes.json', 'utf8'));
  const verdicts = JSON.parse(readFileSync('compare/verdicts.json', 'utf8'));
  const rows = [];
  let open = 0;
  for (const r of routes) {
    const [n, p] = await Promise.all([
      post(NEW, {profile: r.nuovo, points: r.points}),
      post(PROD, {profile: r.produzione, points: r.points, points_encoded: false, elevation: true,
                  instructions: false, details: ['foot_network']}),
    ]);
    if (!n.ok || !p.ok) {
      rows.push({id: r.id, esito: `nuovo ${n.ok ? 'ok' : n.json.stato}, produzione ${p.ok ? 'ok' : p.json.message}`});
      continue;
    }
    const pp = p.json.paths[0];
    const a = {distanceM: n.json.distanceM, ascendM: n.json.ascendM,
               networkShare: share(n.json.segments, n.json.geometry.coordinates.length, s => s.network && s.network !== 'missing')};
    const b = {distanceM: pp.distance, ascendM: pp.ascend,
               networkShare: share((pp.details.foot_network ?? []).map(([from, to, v]) => ({from, to, v})),
                                   pp.points.coordinates.length, s => s.v !== 'missing')};
    const diff = classify(a, b, THRESHOLDS);
    const v = verdicts[r.id];
    if (diff.length && !v) open++;
    rows.push({id: r.id, nuovo: a, produzione: b, differenze: diff, verdetto: v?.verdetto ?? null});
  }
  mkdirSync('compare/risultati', {recursive: true});
  writeFileSync(`compare/risultati/${giro}.json`, JSON.stringify(rows, null, 1));
  for (const x of rows)
    console.log([x.id, x.esito ?? '', x.nuovo ? `${Math.round(x.nuovo.distanceM)}/${Math.round(x.produzione.distanceM)} m` : '',
                 (x.differenze ?? []).join(','), x.verdetto ?? ''].join('\t'));
  console.log(`differenze senza verdetto: ${open}`);
  process.exit(open ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

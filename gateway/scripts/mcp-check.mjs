// Controllo di accettazione del servizio MCP, deterministico e senza AI:
// chiama i tool in-process con la richiesta campione (profilo libero da San
// Giuliano Terme al Monte Serra) e confronta con /v1 vivo — stesso grafo,
// niente dato atteso congelato che invecchia. Uso: node scripts/mcp-check.mjs [url]
import {readFileSync} from 'node:fs';
import {makeRouteTool, makeMcpServer} from '../src/mcp/server.js';
import {makePoiNearbyTool} from '../src/mcp/poi.js';
import {makeFinalTool} from '../src/mcp/server.js';
import {makeDocumentoTool} from '../src/mcp/documento.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

const URL_BASE = process.argv[2] ?? 'http://127.0.0.1:8991';
const KEY = process.env.WM_LINK_KEY
  ?? readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/^WM_LINK_KEY=(.+)$/m)?.[1];
if (!KEY) { console.error('!! serve WM_LINK_KEY (env o .env)'); process.exit(1); }

const CAMPIONE = {points: [[10.4420, 43.7625], [10.5503, 43.7521]], profile: 'libero'};
const SERRA = [10.5553, 43.7514];
let failed = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok' : '!!'} ${label}`); if (!cond) failed = 1; };

// 1. il tool route contro /v1 diretto: stessi numeri, per costruzione
const tool = makeRouteTool({gatewayUrl: URL_BASE, publicUrl: URL_BASE, linkKey: KEY});
const out = await tool(CAMPIONE);
const v1 = await fetch(`${URL_BASE}/v1/mcp/route`, {method: 'POST',
  headers: {'Content-Type': 'application/json'}, body: JSON.stringify(CAMPIONE)}).then(r => r.json());
check(out.distanzaKm === +(v1.distanceM / 1000).toFixed(2), `distanza del tool = /v1 (${out.distanzaKm} km)`);
check(out.salitaM === Math.round(v1.ascendM), `salita del tool = /v1 (${out.salitaM} m)`);
check(out.oreDIN33466 === +v1.timeH.toFixed(2), `ore DIN del tool = /v1 (${out.oreDIN33466})`);
check(out.sentieri?.length > 0, `sentieri aggregati presenti (${out.sentieri?.length})`);

// 2. il link firmato apre la preview e il GPX contiene la geometria di /v1
const rPrev = await fetch(out.linkPreview, {redirect: 'manual'});
check(rPrev.status === 302 && rPrev.headers.get('location')?.includes('/preview/'),
  'linkPreview risponde 302 verso la preview');
const rGpx = await fetch(out.linkGpx);
const gpx = await rGpx.text();
const trkpt = (gpx.match(/<trkpt /g) ?? []).length;
check(rGpx.status === 200 && trkpt === v1.geometry.coordinates.length,
  `linkGpx scarica il GPX con la geometria di /v1 (${trkpt} punti)`);

// 3. un blob manomesso muore con un errore esplicito
const rotto = await fetch(out.linkPreview.replace(/t=(.{10})./, (_, p) => `t=${p}${p[0] === 'A' ? 'B' : 'A'}`));
check(rotto.status === 400, 'blob manomesso: 400, mai un giro');

// 4. poi_nearby trova il Monte Serra vicino alla vetta
const poi = makePoiNearbyTool({waysDbPath: process.env.WM_WAYS_DB
  ?? new URL('../../data/ways.sqlite', import.meta.url).pathname})({point: SERRA, radiusM: 500});
check(poi.poi?.some(p => p.name === 'Monte Serra' && p.wikidata),
  'poi_nearby trova il Monte Serra con il suo identificatore wiki');

// 5. il blocco immagine del profilo, passando dal server MCP vero (in memoria)
const opts = {gatewayUrl: URL_BASE, publicUrl: URL_BASE, linkKey: KEY,
  waysDbPath: process.env.WM_WAYS_DB ?? new URL('../../data/ways.sqlite', import.meta.url).pathname};
const [ct, st] = InMemoryTransport.createLinkedPair();
await makeMcpServer(opts).connect(st);
const client = new Client({name: 'mcp-check', version: '0'});
await client.connect(ct);
const res = await client.callTool({name: 'route', arguments: CAMPIONE});
const img = res.content.find(c => c.type === 'image');
const png = img ? Buffer.from(img.data, 'base64') : Buffer.alloc(0);
check(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'il blocco immagine di route e\' un PNG (firma valida)');
check(png.length > 24 && png.readUInt32BE(16) === 640 && png.readUInt32BE(20) === 200,
  `il PNG del profilo e' 640x200 (${png.length > 24 ? `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}` : 'assente'})`);
await client.close();

// 6. giro_finale con osmId veri della cella; uno inesistente deve restare dichiarato
const MONTE_SERRA = 1733141336, SCARPA = 1304081118, INESISTENTE = 9999999999;
const fin = await makeFinalTool(opts)({...CAMPIONE, poi: [
  {osmId: MONTE_SERRA, nota: 'Vetta del Serra'}, {osmId: SCARPA}, {osmId: INESISTENTE}]});
check(fin.poiRisolti?.some(p => p.osmId === MONTE_SERRA && p.name === 'Monte Serra') && fin.poiRisolti.length === 2,
  'giro_finale risolve Monte Serra e Scarpa d\'Orlando dal database');
check(fin.poiMancanti?.length === 1 && fin.poiMancanti[0] === INESISTENTE,
  'giro_finale dichiara mancante l\'osmId inesistente');
// quota e nome attesi si leggono dal database, mai da valori scritti qui
const Database = (await import('better-sqlite3')).default;
const db = new Database(opts.waysDbPath, {readonly: true, fileMustExist: true});
const rigaSerra = db.prepare('select name, ele from poi where osm_id = ?').get(MONTE_SERRA);
const rigaScarpa = db.prepare('select name, ele from poi where osm_id = ?').get(SCARPA);
db.close();
check(rigaSerra?.name && Number.isFinite(rigaSerra.ele), `database: Monte Serra ha nome e quota (${rigaSerra?.name}, ${rigaSerra?.ele} m)`);
check(rigaScarpa && rigaScarpa.ele == null, 'database: la Scarpa d\'Orlando ha quota nulla');
const gpxFin = await (await fetch(fin.linkGpx)).text();
const xml = t => t.replace(/[<>&'"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'}[c]));
const wptDi = nome => gpxFin.match(new RegExp(`<wpt [^>]*>.*?<name>${xml(nome).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</name>.*?</wpt>`))?.[0] ?? '';
const wSerra = wptDi(rigaSerra.name), wScarpa = wptDi(rigaScarpa.name);
check(wSerra.includes(`<ele>${rigaSerra.ele}</ele>`) && wSerra.includes('<desc>Vetta del Serra</desc>'),
  `il GPX finale ha il <wpt> del Monte Serra con la quota del database e la nota`);
check(wScarpa && !wScarpa.includes('<ele>'), 'il <wpt> della Scarpa d\'Orlando e\' presente e senza <ele>');
check(!gpxFin.includes(String(INESISTENTE)), 'nel GPX non c\'e\' traccia del POI mancante');

// 7. /g/scheda.json risponde coi numeri di /v1 e porta i POI risolti
const sch = await fetch(fin.linkScheda.replace('/g/scheda?', '/g/scheda.json?')).then(r => r.json());
check(sch.distanzaKm === +(v1.distanceM / 1000).toFixed(2) && sch.salitaM === Math.round(v1.ascendM)
  && sch.oreDIN33466 === +v1.timeH.toFixed(2), `/g/scheda.json = /v1 (${sch.distanzaKm} km, +${sch.salitaM} m)`);
check(!!sch.stamp && sch.stampCorrente === sch.stamp, 'scheda: data dei dati del link = data corrente (nessun banner)');
check(JSON.stringify(sch).includes('Monte Serra'), 'la scheda porta i POI risolti');

// 8. blob con POI manomesso (payload cambiato, firma vecchia): 400
const blob = decodeURIComponent(new URL(fin.linkGpx).searchParams.get('t'));
const [payload, sig] = blob.split('.');
const j = JSON.parse(Buffer.from(payload, 'base64url').toString());
j.poi[0].i = SCARPA;
const falso = `${Buffer.from(JSON.stringify(j)).toString('base64url')}.${sig}`;
for (const rotta of ['gpx', 'scheda.json']) {
  const r = await fetch(`${URL_BASE}/g/${rotta}?t=${encodeURIComponent(falso)}`);
  check(r.status === 400, `POI manomesso su /g/${rotta}: 400`);
}

// 9. un POI oltre il tetto: 20 passano, 21 sfiorano
const venti = Array.from({length: 20}, () => ({osmId: MONTE_SERRA}));
check((await makeFinalTool(opts)({...CAMPIONE, poi: venti})).stato === undefined, '20 POI: accettati');
const tetto = await makeFinalTool(opts)({...CAMPIONE, poi: [...venti, {osmId: MONTE_SERRA}]});
check(tetto.stato === 'troppi_poi' && tetto.massimo === 20, '21 POI: troppi_poi (massimo 20)');

// 10. il server MCP espone entrambi i tool
const nomi = (await (async () => {
  const [c2, s2] = InMemoryTransport.createLinkedPair();
  await makeMcpServer(opts).connect(s2);
  const cl = new Client({name: 'mcp-check', version: '0'});
  await cl.connect(c2);
  const t = (await cl.listTools()).tools.map(x => x.name);
  await cl.close();
  return t;
})()).sort().join(',');
check(nomi === 'documento_giro,giro_finale,poi_nearby,route', `il server MCP espone i quattro tool (${nomi})`);

// 11. documento_giro: lo stesso blob, il racconto dell'assistente dentro, e un
// documento che sta in piedi da solo (niente /preview/ da chiedere a nessuno)
const doc = await makeDocumentoTool(opts)({
  t: new URL(fin.linkScheda).searchParams.get('t'),
  introduzione: 'Un giro **lungo** verso la vetta.',
  luoghi: [{osmId: MONTE_SERRA, testo: 'La cima si vede da tutta la piana.'},
           {osmId: INESISTENTE, testo: 'questo non deve comparire'}],
  consigli: '- Acqua alla partenza',
  fonti: [{titolo: 'OpenStreetMap', url: 'https://www.openstreetmap.org/'}],
});
check(doc.stato === undefined && doc.documento?.startsWith('<!doctype html>'),
  `documento_giro produce il documento (${doc.stato ?? doc.nomeFile})`);
check(doc.luoghiIgnorati === 1, `l'osmId fuori dal giro e' scartato e contato (${doc.luoghiIgnorati})`);
check(!doc.documento.includes('/preview/scheda.css') && !doc.documento.includes('/preview/scheda.js'),
  'il documento porta dentro CSS e JavaScript: si apre da file://');
check(doc.documento.includes('questo non deve comparire') === false, 'il testo del luogo scartato non c\'e\'');
const dentro = JSON.parse(doc.documento.match(/id="dati-giro">([\s\S]*?)<\/script>/)[1]);
check(dentro.distanzaKm === sch.distanzaKm && dentro.salitaM === sch.salitaM,
  `i numeri inline sono quelli della scheda (${dentro.distanzaKm} km)`);
check(dentro.racconto.introduzione.includes('<strong>lungo</strong>'), 'il Markdown dell\'assistente e\' reso');
const troppo = await makeDocumentoTool(opts)({
  t: new URL(fin.linkScheda).searchParams.get('t'), consigli: 'x'.repeat(20001)});
check(troppo.stato === 'testo_troppo_lungo' && troppo.slot === 'consigli',
  `uno slot oltre il massimo e' un errore che dice quale (${troppo.slot})`);
check((await makeDocumentoTool(opts)({t: falso})).stato === 'firma_non_valida',
  'documento_giro su blob manomesso: firma_non_valida');

process.exit(failed);

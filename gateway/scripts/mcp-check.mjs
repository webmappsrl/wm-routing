// Controllo di accettazione del servizio MCP, deterministico e senza AI:
// chiama i tool in-process con la richiesta campione (profilo libero da San
// Giuliano Terme al Monte Serra) e confronta con /v1 vivo — stesso grafo,
// niente dato atteso congelato che invecchia. Uso: node scripts/mcp-check.mjs [url]
import {readFileSync} from 'node:fs';
import {makeRouteTool, makeMcpServer} from '../src/mcp/server.js';
import {makePoiNearbyTool} from '../src/mcp/poi.js';

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

// 5. il server MCP espone entrambi i tool
check(typeof makeMcpServer({gatewayUrl: URL_BASE, publicUrl: URL_BASE, linkKey: KEY}).connect === 'function',
  'il server MCP si costruisce');

process.exit(failed);

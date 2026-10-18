import {it, expect} from 'vitest';
import express from 'express';
import request from 'supertest';
import {encodeLink} from '../src/mcp/link.js';
import {makeGRouter} from '../src/mcp/g-route.js';
import {HttpError, makeFallbackRoute} from '../src/route.js';

const key = 'chiave-di-prova';
const bbox = [10, 43, 11, 44];
const geometry = {type: 'LineString', coordinates: [[10.1, 43.1, 100], [10.15, 43.15, 150], [10.2, 43.2, 200]]};
const okCompute = async () => ({geometry, profile: 'libero'});
const app = (compute = okCompute, resolvePoi, dataStamp = () => ({osm: '2026-10-08T20:21:06Z'})) => {
  const a = express();
  a.use('/g', makeGRouter({compute, shard: {profiles: {libero: 'libero'}}, bbox, key, resolvePoi, dataStamp}));
  return a;
};
const blob = encodeLink({points: [[10.1, 43.1], [10.2, 43.2]], profile: 'libero', stamp: '2026-10-08T20:21:06Z'}, key);

it('blob valido: 302 verso la preview con p, profilo e d', async () => {
  const r = await request(app()).get('/g/').query({t: blob});
  expect(r.status).toBe(302);
  expect(r.headers.location).toContain('/preview/?');
  expect(r.headers.location).toContain('p=');
  expect(r.headers.location).toContain('profilo=libero');
  expect(r.headers.location).toContain('2026-10-08');
});

it('blob alterato: 400 con la pagina che spiega, mai un giro', async () => {
  const altered = blob.slice(0, 12) + (blob[12] === 'A' ? 'B' : 'A') + blob.slice(13);
  const r = await request(app()).get('/g/').query({t: altered});
  expect(r.status).toBe(400);
  expect(r.text).toContain('alterato');
});

it('gpx valido: 200, file in allegato con la traccia', async () => {
  const r = await request(app()).get('/g/gpx').query({t: blob});
  expect(r.status).toBe(200);
  expect(r.headers['content-disposition']).toContain('attachment');
  expect(r.text).toContain('<trk>');
  expect((r.text.match(/<trkpt /g) ?? [])).toHaveLength(3);
});

it('gpx con motore in errore: stato e messaggio, nessun file', async () => {
  const broken = async () => { throw new HttpError(503, 'riprova'); };
  const r = await request(app(broken)).get('/g/gpx').query({t: blob});
  expect(r.status).toBe(503);
  expect(r.body.stato).toBe('riprova');
  expect(r.text).not.toContain('<gpx');
});

it('gpx di un giro riuscito solo col fallback per tratti: il file scende comunque', async () => {
  // composizione come in server.js: makeFallbackRoute sopra il compute
  const config = {profiles: {libero: {mode: 'foot', version: '1'}}};
  const core = async (shard, profile, points) => {
    if (points.length > 2) throw new HttpError(404, 'nessun_percorso');   // giro intero: no
    return {geometry, profile, distanceM: 1000, ascendM: 0, descendM: 0, timeH: 1,
            segments: [], waypoints: [], offTrailPoints: [], connectors: []};
  };
  const withFallback = makeFallbackRoute({config, compute: core});
  const a = express();
  a.use('/g', makeGRouter({compute: withFallback, shard: {profiles: {libero: 'libero'}}, bbox, key}));
  const tre = encodeLink({points: [[10.1, 43.1], [10.15, 43.15], [10.2, 43.2]], profile: 'libero', stamp: 'X'}, key);
  const r = await request(a).get('/g/gpx').query({t: tre});
  expect(r.status).toBe(200);
  expect(r.text).toContain('<trk>');
});

it('oltre il rate limit: 429, anche su /g/gpx', async () => {
  const a = express();
  a.use('/g', makeGRouter({compute: okCompute, shard: {profiles: {libero: 'libero'}}, bbox, key,
                           rate: {capacity: 1, perSecond: 0.001}}));
  await request(a).get('/g/').query({t: blob});
  const r = await request(a).get('/g/gpx').query({t: blob});
  expect(r.status).toBe(429);
  expect(r.body.stato).toBe('troppe_richieste');
});

it('punti fuori dall\'area: 400 con l\'area dichiarata', async () => {
  const fuori = encodeLink({points: [[20, 50], [21, 51]], profile: 'libero', stamp: 'X'}, key);
  for (const path of ['/g/', '/g/gpx']) {
    const r = await request(app()).get(path).query({t: fuori});
    expect(r.status).toBe(400);
    expect(r.text).toContain('fuori dall’area');
  }
});

const pts = [[10.1, 43.1], [10.2, 43.2]];
const stamp = '2026-10-08T20:21:06Z';
const fakeResolve = ids => ({
  trovati: ids.filter(i => i === 1733141336)
    .map(osmId => ({osmId, name: 'Monte Serra', kind: 'peak', ele: 917, lon: 10.5, lat: 43.75})),
  mancanti: ids.filter(i => i !== 1733141336), nonValidi: 0});

it('gpx con poi nel blob: wpt coi nomi del database e la nota del blob', async () => {
  const t = encodeLink({points: pts, profile: 'libero', stamp,
    poi: [{osmId: 1733141336, nota: 'Cima & vista'}, {osmId: 99, nota: 'sparito'}]}, key);
  const r = await request(app(okCompute, fakeResolve)).get('/g/gpx').query({t});
  expect(r.status).toBe(200);
  expect(r.text).toContain('<name>Monte Serra</name>');
  expect(r.text).toContain('<desc>Cima &amp; vista</desc>');
  expect(r.text).toContain('<ele>917</ele>');
  expect(r.text).not.toContain('sparito');
  expect(r.text.match(/<wpt /g)).toHaveLength(3);
});

it('blob senza poi: stesso GPX di prima, resolvePoi non interpellato', async () => {
  let chiamato = false;
  const spia = ids => { chiamato = true; return fakeResolve(ids); };
  const senza = await request(app(okCompute, spia)).get('/g/gpx').query({t: blob});
  const base = await request(app()).get('/g/gpx').query({t: blob});
  expect(senza.text).toBe(base.text);
  expect(chiamato).toBe(false);
});

it('database dei poi non leggibile: il GPX scende comunque senza poi', async () => {
  const t = encodeLink({points: pts, profile: 'libero', stamp, poi: [{osmId: 1, nota: 'x'}]}, key);
  const rotto = () => { throw new Error('db'); };
  const r = await request(app(okCompute, rotto)).get('/g/gpx').query({t});
  expect(r.status).toBe(200);
  expect(r.text.match(/<wpt /g)).toHaveLength(2);
});

it('database dei poi non leggibile: il GPX lo dichiara e il log porta il flag, senza dati', async () => {
  const t = encodeLink({points: pts, profile: 'libero', stamp, poi: [{osmId: 1733141336, nota: 'NOTA-SEGRETA'}]}, key);
  const scritti = [];
  const orig = process.stdout.write;
  process.stdout.write = c => { scritti.push(String(c)); return true; };
  let r;
  try {
    r = await request(app(okCompute, () => { throw new Error('db'); })).get('/g/gpx').query({t});
    // errore riportato dal resolver come valore, non come eccezione
    await request(app(okCompute, () => ({errore: true}))).get('/g/gpx').query({t});
  } finally { process.stdout.write = orig; }
  expect(r.status).toBe(200);
  expect(r.text).toMatch(/punti di interesse non erano disponibili/);
  const log = scritti.join('');
  expect(log).toContain('poi_non_disponibili');
  expect(log).not.toContain('NOTA-SEGRETA');
  expect(log).not.toContain('1733141336');
  expect(scritti.filter(l => l.includes('poi_non_disponibili'))).toHaveLength(2);
});

it('blob con poi inesistenti nel database: nessuna dichiarazione di guasto', async () => {
  const t = encodeLink({points: pts, profile: 'libero', stamp, poi: [{osmId: 99, nota: 'x'}]}, key);
  const r = await request(app(okCompute, fakeResolve)).get('/g/gpx').query({t});
  expect(r.text).not.toMatch(/non erano disponibili/);
});

// --- scheda stampabile ---
const full = async () => ({geometry, profile: 'libero', distanceM: 12345, ascendM: 600.4, descendM: 120,
  timeH: 4.25, segments: [{from: 0, to: 2, ref: '00', difficulty: 'T', roadClass: 'path'}],
  waypoints: [{punto: 1, distanceM: 0, timeH: 0}, {punto: 2, distanceM: 12345, timeH: 4.25}],
  warning: 'avvertenza'});

it('scheda: 200 HTML con blob valido', async () => {
  const r = await request(app()).get('/g/scheda').query({t: blob});
  expect(r.status).toBe(200);
  expect(r.headers['content-type']).toContain('text/html');
  expect(r.text).toContain('scheda.js');
});

it('scheda.json: totali, tappe e sentieri del percorso, poi coi nomi del database', async () => {
  const t = encodeLink({points: pts, profile: 'libero', stamp,
    poi: [{osmId: 1733141336, nota: 'Cima'}, {osmId: 99, nota: 'sparito'}]}, key);
  const r = await request(app(full, fakeResolve)).get('/g/scheda.json').query({t});
  expect(r.status).toBe(200);
  expect(r.body.distanzaKm).toBe(12.35);
  expect(r.body.salitaM).toBe(600);
  expect(r.body.oreDIN33466).toBe(4.25);
  expect(r.body.tappe).toHaveLength(2);
  expect(r.body.sentieri[0].ref).toBe('00');
  expect(r.body.geometry.coordinates).toHaveLength(3);
  expect(r.body.stamp).toBe(stamp);
  expect(r.body.stampCorrente).toBe(stamp);
  expect(r.body.poi).toEqual([{osmId: 1733141336, name: 'Monte Serra', kind: 'peak', ele: 917, lonLat: [10.5, 43.75], nota: 'Cima'}]);
  expect(r.body.poiMancanti).toBe(1);
  expect(r.body.poiNonDisponibili).toBe(false);
});

it('scheda.json: blob v1 senza poi dà poi vuoto e il resto invariato', async () => {
  const r = await request(app(full)).get('/g/scheda.json').query({t: blob});
  expect(r.status).toBe(200);
  expect(r.body.poi).toEqual([]);
  expect(r.body.distanzaKm).toBe(12.35);
  expect(r.body.profilo).toBe('libero');
});

it('scheda.json: stampCorrente diverso dal blob quando i dati sono cambiati', async () => {
  const r = await request(app(full, undefined, () => ({osm: 'nuovo'}))).get('/g/scheda.json').query({t: blob});
  expect(r.body.stampCorrente).toBe('nuovo');
  expect(r.body.stamp).toBe('2026-10-08T20:21:06Z');
});

it('scheda.json: guasto del database dei poi segnalato, non spacciato per poi inesistenti', async () => {
  const t = encodeLink({points: pts, profile: 'libero', stamp, poi: [{osmId: 1, nota: 'x'}]}, key);
  for (const rotto of [() => ({trovati: [], mancanti: [], nonValidi: 0, errore: true}),
                       () => { throw new Error('db'); }]) {
    const r = await request(app(full, rotto)).get('/g/scheda.json').query({t});
    expect(r.status).toBe(200);
    expect(r.body.poi).toEqual([]);
    expect(r.body.poiNonDisponibili).toBe(true);
    expect(r.body.poiMancanti).toBe(0);
  }
});

it('scheda: blob manomesso 400 «alterato», punti fuori area 400 con l\'area', async () => {
  const altered = blob.slice(0, 12) + (blob[12] === 'A' ? 'B' : 'A') + blob.slice(13);
  const fuori = encodeLink({points: [[20, 50], [21, 51]], profile: 'libero', stamp: 'X'}, key);
  for (const path of ['/g/scheda', '/g/scheda.json']) {
    const a = await request(app()).get(path).query({t: altered});
    expect(a.status).toBe(400);
    expect(a.text).toContain('alterato');
    const f = await request(app()).get(path).query({t: fuori});
    expect(f.status).toBe(400);
    expect(f.text).toContain('10, 43, 11, 44');
  }
});

it('scheda.json con motore in errore: stato e messaggio', async () => {
  const broken = async () => { throw new HttpError(503, 'riprova'); };
  const r = await request(app(broken)).get('/g/scheda.json').query({t: blob});
  expect(r.status).toBe(503);
  expect(r.body.stato).toBe('riprova');
});

it('scheda.json: la nota del blob sta nel JSON ma la pagina scheda non include blob né coordinate', async () => {
  const r = await request(app()).get('/g/scheda').query({t: blob});
  expect(r.text).not.toContain(blob);
});

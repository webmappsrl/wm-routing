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
const app = (compute = okCompute) => {
  const a = express();
  a.use('/g', makeGRouter({compute, shard: {profiles: {libero: 'libero'}}, bbox, key}));
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

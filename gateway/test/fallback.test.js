import {it, expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {makeRouteHandler} from '../src/route.js';

const P0 = [10, 44], P1 = [10.01, 44], P2 = [10.02, 44];
const config = {
  shards: {s: {profiles: {escursionista: 'escursionista', esperto: 'esperto', libero: 'libero'},
    origins: [], limits: false, rate: {capacity: 100, perSecond: 100}}},
  profiles: {escursionista: {mode: 'foot', version: '2', next: 'esperto'},
             esperto: {mode: 'foot', version: '2', next: 'libero'},
             libero: {mode: 'foot', version: '1'}},
};
const leg = (a, b, rating) => ({distance: 1000, ascend: 50, descend: 10, time: 900000,
  points: {type: 'LineString', coordinates: [[...a, 100], [...b, 150]]},
  snapped_waypoints: {type: 'MultiPoint', coordinates: [a, b]},
  details: {osm_way_id: [[0, 1, 7]], hike_rating: [[0, 1, rating]], road_class: [[0, 1, 'path']]}});
const notFound = {ok: false, status: 400, json: {message: 'Connection between locations not found'}};
const same = (p, q) => p[0] === q[0] && p[1] === q[1];

function make(engineFn, calls) {
  const engine = {route: async b => { calls.push(b); return engineFn(b); }};
  const route = makeRouteHandler({config, engine, waysDb: null, dataStamp: () => ({osm: 'X'}),
    bbox: [6.65, 35.45, 18.55, 47.05], retry: {timeoutMs: 0, stepMs: 0, sleep: async () => {}}});
  return createApp({config, dataStamp: () => ({}), handlers: {route}});
}
// il tratto P1-P2 si fa solo con esperto o libero
const engine = b => {
  const hard = b.points.some(p => same(p, P2));
  if (hard && b.profile === 'escursionista') return notFound;
  if (b.points.length > 2) return notFound;
  return {ok: true, status: 200, json: {paths: [leg(b.points[0], b.points[1], hard ? 3 : 2)]}};
};

it('mai senza percorso: il tratto che il profilo non fa passa al profilo successivo, e si dice', async () => {
  const calls = [];
  const r = await request(make(engine, calls)).post('/v1/s/route').send({profile: 'escursionista', points: [P0, P1, P2]});
  expect(r.status).toBe(200);
  expect(r.body.profile).toBe('escursionista');
  expect(r.body.fallbackLegs).toEqual([{from: 1, to: 2, profile: 'esperto'}]);
  expect(r.body.distanceM).toBe(2000);
  expect(r.body.geometry.coordinates).toHaveLength(3);
  expect(r.body.segments.map(s => s.profile)).toEqual(['escursionista', 'esperto']);
  expect(r.body.segments[1]).toMatchObject({from: 1, to: 2, difficulty: 'EE'});
});
it('un tratto impossibile con tutti i profili: 404 nessun_percorso', async () => {
  const calls = [];
  const r = await request(make(b => (b.points.some(p => same(p, P2)) ? notFound : engine(b)), calls))
    .post('/v1/s/route').send({profile: 'escursionista', points: [P0, P1, P2]});
  expect(r.status).toBe(404);
  expect(r.body).toMatchObject({stato: 'nessun_percorso', punto: 2});
});
it('se il giro riesce subito, nessun calcolo in piu\'', async () => {
  const calls = [];
  const ok = b => ({ok: true, status: 200, json: {paths: [leg(P0, P1, 2)]}});
  const r = await request(make(ok, calls)).post('/v1/s/route').send({profile: 'escursionista', points: [P0, P1]});
  expect(r.status).toBe(200);
  expect(r.body.fallbackLegs).toEqual([]);
  expect(calls).toHaveLength(1);
});

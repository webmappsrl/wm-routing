import {it, expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {makeRouteHandler} from '../src/route.js';

const config = {
  shards: {
    s: {profiles: {escursionista: 'escursionista', esperto: 'esperto', prudente: 'prudente'},
        origins: [], limits: false, rate: {capacity: 100, perSecond: 100}},
    p: {profiles: {escursionista: 'escursionista'}, origins: [], limits: true,
        rate: {capacity: 100, perSecond: 100}},
  },
  profiles: {escursionista: {mode: 'foot', version: '2', next: 'esperto'},
             esperto: {mode: 'foot', version: '1', next: 'alpinista'},
             prudente: {mode: 'foot', version: '1', next: 'escursionista'}},
};
const ghPath = (over = {}) => ({distance: 1000, ascend: 100, descend: 0, time: 900000,
  points: {type: 'LineString', coordinates: [[10, 44, 500], [10.01, 44, 600]]},
  details: {osm_way_id: [[0, 1, 1]], hike_rating: [[0, 1, 2]]}, ...over});
const NO_WAIT = {timeoutMs: 0, stepMs: 0, sleep: async () => {}};
const make = (engineRoute, calls = [], month = 7) => {
  const engine = {route: async body => { calls.push(body); return engineRoute(body); }};
  const route = makeRouteHandler({config, engine, waysDb: null, dataStamp: () => ({osm: 'X'}),
    bbox: [6.65, 35.45, 18.55, 47.05], retry: NO_WAIT, month: () => month});
  return createApp({config, dataStamp: () => ({osm: 'X'}), handlers: {route}});
};
const body = {profile: 'escursionista', points: [[10, 44], [10.01, 44]]};
const ok = async () => ({ok: true, status: 200, json: {paths: [ghPath()]}});

it('risposta completa, con il tempo DIN e senza il time del motore', async () => {
  const r = await request(make(ok)).post('/v1/s/route').send(body);
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({profile: 'escursionista', profileVersion: '2', data: {osm: 'X'},
                                distanceM: 1000, ascendM: 100});
  expect(r.body.timeH).toBeCloseTo(0.4583, 3);   // max(0,25; 0,333) + 0,25/2
  expect(r.body.warning).toMatch(/percorribilità/);
  expect(r.body.snowWarning).toBe(false);
  expect(JSON.stringify(r.body)).not.toContain('900000');
});
it('avviso neve sopra 2000 m fra novembre e maggio', async () => {
  const high = async () => ({ok: true, status: 200, json: {paths: [ghPath({
    points: {type: 'LineString', coordinates: [[10, 44, 1900], [10.01, 44, 2150]]}})]}});
  expect((await request(make(high, [], 3)).post('/v1/s/route').send(body)).body.snowWarning).toBe(true);
  expect((await request(make(high, [], 7)).post('/v1/s/route').send(body)).body.snowWarning).toBe(false);
});
it('profilo non dello shard: 400', async () => {
  const r = await request(make(ok)).post('/v1/s/route').send({...body, profile: 'mtb'});
  expect(r.status).toBe(400);
  expect(r.body.stato).toBe('profilo_non_ammesso');
});
it('punti fuori area o invertiti (lat,lon): 400 prima del motore', async () => {
  const calls = [];
  const r = await request(make(ok, calls)).post('/v1/s/route')
    .send({...body, points: [[44, 10], [44.01, 10]]});
  expect(r.status).toBe(400);
  expect(r.body.stato).toBe('fuori_area');
  expect(calls).toHaveLength(0);
});
it('nessun collegamento con nessun profilo: 404 con il tratto che non si fa', async () => {
  const r = await request(make(async () => ({ok: false, status: 400,
    json: {message: 'Connection between locations not found'}}))).post('/v1/s/route').send(body);
  expect(r.status).toBe(404);
  expect(r.body).toEqual({stato: 'nessun_percorso', punto: 1});
});
it('motore spento oltre la coda: 503 riprova', async () => {
  const r = await request(make(async () => { throw new Error('ECONNREFUSED'); }))
    .post('/v1/s/route').send(body);
  expect(r.status).toBe(503);
  expect(r.body.stato).toBe('riprova');
});
it('i limiti per richiesta solo sugli shard che li ammettono', async () => {
  const calls = [];
  expect((await request(make(ok)).post('/v1/s/route').send({...body, limits: {maxHikeRating: 1}})).status).toBe(400);
  await request(make(ok, calls)).post('/v1/p/route').send({...body, limits: {maxHikeRating: 1, excludeUnknown: true}});
  expect(calls[0].custom_model.parameters.max_hike_rating).toBe(1);
  expect(calls[0].custom_model.priority).toEqual([{if: 'road_class == PATH && hike_rating == 0', multiply_by: '0'}]);
});
it('alternative: i profili accanto, solo se il tracciato cambia', async () => {
  const calls = [];
  const engine = async b => ({ok: true, status: 200, json: {paths: [
    ghPath({distance: b.profile === 'esperto' ? 700 : 1000})]}});
  const r = await request(make(engine, calls)).post('/v1/s/route').send({...body, alternatives: true});
  expect(calls.map(c => c.profile).sort()).toEqual(['escursionista', 'esperto', 'prudente']);
  expect(r.body.alternatives).toEqual([expect.objectContaining({profile: 'esperto', distanceM: 700})]);
});
it('troppi punti: 400 prima del motore', async () => {
  const calls = [];
  const points = Array.from({length: 11}, (_, i) => [10 + i * 0.001, 44]);
  const r = await request(make(ok, calls)).post('/v1/s/route').send({...body, points});
  expect(r.status).toBe(400);
  expect(r.body.stato).toBe('troppi_punti');
  expect(calls).toHaveLength(0);
});
it("alternative per mtb: nessun profilo a piedi", async () => {
  const cfg = {...config, shards: {m: {profiles: {mtb: 'mtb', prudente: 'prudente'}, origins: [], limits: false,
    rate: {capacity: 100, perSecond: 100}}}, profiles: {...config.profiles, mtb: {mode: 'mtb', version: '1'}}};
  const calls = [];
  const engine = {route: async b => { calls.push(b); return {ok: true, status: 200, json: {paths: [ghPath()]}}; }};
  const route = makeRouteHandler({config: cfg, engine, waysDb: null, dataStamp: () => ({osm: 'X'}),
    bbox: [6.65, 35.45, 18.55, 47.05], retry: NO_WAIT});
  const r = await request(createApp({config: cfg, dataStamp: () => ({}), handlers: {route}}))
    .post('/v1/m/route').send({profile: 'mtb', points: body.points, alternatives: true});
  expect(calls.map(c => c.profile)).toEqual(['mtb']);
  expect(r.body.alternatives).toEqual([]);
});
const snapAt = coords => ghPath({snapped_waypoints: {type: 'MultiPoint', coordinates: coords}});
const FAR = [[10, 44], [10.01, 44.008]];        // arrivo agganciato a ~900 m
const NEAR = [[10, 44], [10.0101, 44.0002]];

it('il profilo non arriva dove arriva alpinista: il tratto si calcola con alpinista e si dice', async () => {
  // come la vetta del Monte Serra per prudente: alpinista la raggiunge, il profilo no
  const engine = async b => ({ok: true, status: 200, json: {paths: [snapAt(b.profile === 'alpinista' ? NEAR : FAR)]}});
  const cfg = {...config, shards: {...config.shards, s: {...config.shards.s,
    profiles: {...config.shards.s.profiles, alpinista: 'alpinista'}}},
    profiles: {...config.profiles, alpinista: {mode: 'foot', version: '1'}}};
  const route = makeRouteHandler({config: cfg, engine: {route: engine}, waysDb: null, dataStamp: () => ({osm: 'X'}),
    bbox: [6.65, 35.45, 18.55, 47.05], retry: NO_WAIT});
  const r = await request(createApp({config: cfg, dataStamp: () => ({}), handlers: {route}})).post('/v1/s/route').send(body);
  expect(r.status).toBe(200);
  expect(r.body.profile).toBe('escursionista');
  expect(r.body.fallbackLegs).toEqual([{from: 0, to: 1, profile: 'alpinista'}]);
});
it('punto lontano da ogni sentiero (anche per alpinista): il percorso si da\' con l\'avviso', async () => {
  const engine = async () => ({ok: true, status: 200, json: {paths: [snapAt(FAR)]}});
  const cfg = {...config, shards: {...config.shards, s: {...config.shards.s,
    profiles: {...config.shards.s.profiles, alpinista: 'alpinista'}}},
    profiles: {...config.profiles, alpinista: {mode: 'foot', version: '1'}}};
  const route = makeRouteHandler({config: cfg, engine: {route: engine}, waysDb: null, dataStamp: () => ({osm: 'X'}),
    bbox: [6.65, 35.45, 18.55, 47.05], retry: NO_WAIT});
  const r = await request(createApp({config: cfg, dataStamp: () => ({}), handlers: {route}})).post('/v1/s/route').send(body);
  expect(r.status).toBe(200);
  expect(r.body.offTrailPoints).toEqual([{punto: 1, distanceM: expect.any(Number)}]);
  expect(r.body.offTrailPoints[0].distanceM).toBeGreaterThan(800);
});
it('aggancio vicino (entro 50 m): il percorso va bene', async () => {
  const near = async () => ({ok: true, status: 200, json: {paths: [ghPath({
    snapped_waypoints: {type: 'MultiPoint', coordinates: [[10.0002, 44.0001], [10.0101, 44.0002]]}})]}});
  expect((await request(make(near)).post('/v1/s/route').send(body)).status).toBe(200);
});
it('raccordi: per ogni punto il tratto fra il punto chiesto e quello agganciato', async () => {
  const near = async () => ({ok: true, status: 200, json: {paths: [ghPath({
    snapped_waypoints: {type: 'MultiPoint', coordinates: [[10, 44], [10.0101, 44.0002]]}})]}});
  const r = await request(make(near)).post('/v1/s/route').send(body);
  expect(r.body.connectors).toEqual([
    {punto: 1, from: [10.01, 44], to: [10.0101, 44.0002], distanceM: expect.any(Number)}]);
  expect(r.body.connectors[0].distanceM).toBeGreaterThan(20);
});

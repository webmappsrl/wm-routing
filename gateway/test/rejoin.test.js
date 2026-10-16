import {it, expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {makeRejoinHandler} from '../src/rejoin/rejoin.js';

const config = {
  shards: {s: {profiles: {escursionista: 'escursionista', mtb: 'mtb'}, origins: [], limits: false,
               rate: {capacity: 100, perSecond: 100}}},
  profiles: {escursionista: {mode: 'foot', version: '1'}, mtb: {mode: 'mtb', version: '1'}},
};
const track = [[10, 44], [10.03, 44]];          // circa 2,4 km verso est
// finto calcolo: il rientro costa la linea d'aria; il motore aggancia 100 m piu' a sud
const compute = async (_shard, profile, points) => {
  const [a, b] = points;
  const d = Math.hypot((b[0] - a[0]) * 80000, (b[1] - a[1]) * 111000);
  return {profile, distanceM: d, timeH: d / 4000,
          geometry: {type: 'LineString', coordinates: points},
          snapped: {type: 'MultiPoint', coordinates: [[a[0], a[1] - 0.0009], b]}};
};
const handler = (match = async () => ({ok: false})) => makeRejoinHandler({config, engine: {match}, compute,
  bands: {minM: 50, maxM: {foot: 1000, mtb: 2000}}, offsetsM: [0, 500, 1000],
  matchLimits: {meanM: 30, maxM: 100}, bbox: [6.65, 35.45, 18.55, 47.05]});
const post = (b, match) => request(createApp({config, dataStamp: () => ({}), handlers: {rejoin: handler(match)}}))
  .post('/v1/s/rejoin').send({profile: 'escursionista', track, ...b});

it('sotto 50 m: su_traccia, nessun calcolo', async () => {
  expect((await post({position: [10.01, 44.0002], progressM: 500})).body.stato).toBe('su_traccia');
});
it("oltre 1 km a piedi: troppo_lontano; in mtb lo stesso punto e' dentro i 2 km", async () => {
  const pos = [10.01, 44.012];
  expect((await post({position: pos, progressM: 0})).body.stato).toBe('troppo_lontano');
  expect((await post({profile: 'mtb', position: pos, progressM: 0})).body.stato).toBe('rientro');
});
it('in avanti: il punto di rientro sta davanti al punto raggiunto', async () => {
  const r = await post({position: [10.005, 44.002], progressM: 1200});
  expect(r.body.stato).toBe('rientro');
  expect(r.body.joinAtM).toBeGreaterThanOrEqual(1200);
});
it('traccia dritta senza ostacoli: si rientra nel punto piu\' vicino, non in quello lontano', async () => {
  const r = await post({position: [10.005, 44.002], progressM: 0});
  const proj = 0.005 * 80000;                 // circa 400 m lungo la traccia
  expect(Math.abs(r.body.joinAtM - proj)).toBeLessThan(50);
});
it('indietro: il punto di rientro sta dietro', async () => {
  const r = await post({position: [10.02, 44.002], progressM: 1200, direction: 'backward'});
  expect(r.body.joinAtM).toBeLessThanOrEqual(1200);
});
it('tratto fuori sentiero dal punto agganciato', async () => {
  expect((await post({position: [10.005, 44.002], progressM: 0})).body.offPathM).toBeGreaterThan(90);
});
it('traccia degenere: 400', async () => {
  for (const t of [[[10, 44]], [[10, 44], [10, 44]]]) {
    const r = await post({track: t, position: [10, 44.002], progressM: 0});
    expect(r.status).toBe(400);
    expect(r.body.stato).toBe('traccia_non_valida');
  }
});
it('map matching troppo lontano dalla traccia: 422', async () => {
  const far = async () => ({ok: true, json: {paths: [{points: {coordinates: [[10, 44.01], [10.03, 44.01]]}}]}});
  const r = await post({position: [10.005, 44.002], progressM: 0, matchTrack: true}, far);
  expect(r.status).toBe(422);
  expect(r.body.stato).toBe('traccia_non_su_osm');
});
it('posizione mancante o fuori area: 400 prima del motore', async () => {
  for (const position of [undefined, [10.5, 'x'], [44, 10]]) {
    const r = await post({position, progressM: 0});
    expect(r.status).toBe(400);
    expect(r.body.stato).toBe('fuori_area');
  }
});
it('traccia con punti non validi o troppo lunga: 400', async () => {
  expect((await post({track: [[10, 44], [NaN, 44]], position: [10, 44.002], progressM: 0})).body.stato)
    .toBe('traccia_non_valida');
  const long = Array.from({length: 5001}, (_, i) => [10 + i * 1e-5, 44]);
  expect((await post({track: long, position: [10, 44.002], progressM: 0})).body.stato).toBe('traccia_non_valida');
});
it('il rientro parte esattamente dalla persona: il tratto fuori sentiero sta nella geometria', async () => {
  const pos = [10.005, 44.002];
  const r = await post({position: pos, progressM: 0});
  const g = r.body.route.geometry.coordinates;
  expect(g[0].slice(0, 2)).toEqual(pos);
  expect(r.body.route.segments[0]).toMatchObject({from: 0, to: 1, offTrail: true});
  expect(r.body.route.distanceM).toBeGreaterThan(r.body.offPathM);
});

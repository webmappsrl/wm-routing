import {it, expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';

const config = {
  shards: {s: {profiles: {escursionista: 'escursionista'}, origins: ['https://ok.it'],
               limits: false, rate: {capacity: 1, perSecond: 0.001}}},
  profiles: {escursionista: {mode: 'foot', version: '3'}},
};
const app = () => createApp({config,
  dataStamp: () => ({osm: '2026-10-15T20:21:02Z', builtAt: '2026-10-16T03:00:00Z'})});

it('/v1/version espone la data dei dati, senza cache', async () => {
  const r = await request(app()).get('/v1/version');
  expect(r.body.osm).toBe('2026-10-15T20:21:02Z');
  expect(r.headers['cache-control']).toBe('no-cache');
});
it('/v1/:shard/profiles elenca i profili con la versione', async () => {
  const r = await request(app()).get('/v1/s/profiles').set('Origin', 'https://ok.it');
  expect(r.body).toEqual([{name: 'escursionista', mode: 'foot', version: '3'}]);
  expect(r.headers['access-control-allow-origin']).toBe('https://ok.it');
});
it('shard sconosciuto: 404', async () => {
  expect((await request(app()).get('/v1/nessuno/profiles')).status).toBe(404);
});
it('dietro il proxy il limite e\' per utente (X-Forwarded-For)', async () => {
  const a = app();
  expect((await request(a).get('/v1/s/profiles').set('X-Forwarded-For', '203.0.113.1')).status).toBe(200);
  expect((await request(a).get('/v1/s/profiles').set('X-Forwarded-For', '203.0.113.2')).status).toBe(200);
  expect((await request(a).get('/v1/s/profiles').set('X-Forwarded-For', '203.0.113.1')).status).toBe(429);
});
it('limite di richieste anche senza Origin, e senza intestazioni CORS', async () => {
  const a = app();
  expect((await request(a).get('/v1/s/profiles')).status).toBe(200);
  const r = await request(a).get('/v1/s/profiles');
  expect(r.status).toBe(429);
  expect(r.headers['access-control-allow-origin']).toBeUndefined();
});
it('si fida del proxy anche quando arriva dal bridge di Docker (Caddy -> container)', () => {
  const trust = app().get('trust proxy fn');
  expect(trust('127.0.0.1', 0)).toBe(true);
  expect(trust('172.18.0.1', 0)).toBe(true);     // gateway del bridge Docker
  expect(trust('203.0.113.5', 0)).toBe(false);   // un indirizzo pubblico no
});

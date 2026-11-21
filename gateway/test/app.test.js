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
it("/v1/version dice anche l'area coperta dai dati, per disegnarla nella preview", async () => {
  const a = createApp({config, area: [10, 43, 11, 44], dataStamp: () => ({osm: 'X'})});
  expect((await request(a).get('/v1/version')).body).toEqual({osm: 'X', area: [10, 43, 11, 44]});
});
it('la radice porta alla preview, come le tile', async () => {
  const r = await request(app()).get('/');
  expect(r.status).toBe(302);
  expect(r.headers.location).toBe('/preview/');
});

// --- la credenziale sulle rotte dei dati ---------------------------------
const TOKEN = 'token-di-prova-12345';
const withToken = (spy, v1Token = TOKEN) => createApp({config, v1Token,
  dataStamp: () => ({osm: 'X'}), handlers: {route: spy}});

it('con il token configurato, una richiesta senza intestazione riceve 401 e non arriva all\'handler', async () => {
  let calls = 0;
  const spy = (_req, res) => { calls += 1; res.json({ok: true}); };
  const r = await request(withToken(spy)).post('/v1/s/route').send({});
  expect(r.status).toBe(401);
  expect(r.body).toEqual({stato: 'non_autorizzato'});
  expect(calls).toBe(0);
});
it("con l'intestazione giusta la richiesta passa", async () => {
  let calls = 0;
  const spy = (_req, res) => { calls += 1; res.json({ok: true}); };
  const r = await request(withToken(spy)).post('/v1/s/route')
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  expect(r.status).toBe(200);
  expect(calls).toBe(1);
});
it('un token sbagliato riceve 401, anche se e\' lungo uguale', async () => {
  const spy = (_req, res) => res.json({ok: true});
  const sameLength = 'x'.repeat(TOKEN.length);
  expect((await request(withToken(spy)).post('/v1/s/route')
    .set('Authorization', 'Bearer sbagliato').send({})).status).toBe(401);
  expect((await request(withToken(spy)).post('/v1/s/route')
    .set('Authorization', `Bearer ${sameLength}`).send({})).status).toBe(401);
  expect((await request(withToken(spy)).post('/v1/s/route')
    .set('Authorization', TOKEN).send({})).status).toBe(401);
});
it('/v1/version resta aperta: e\' la prova di vita del rilascio', async () => {
  const r = await request(withToken(() => {})).get('/v1/version');
  expect(r.status).toBe(200);
  expect(r.body.osm).toBe('X');
});
it('senza token configurato le rotte restano aperte: e\' lo sviluppo sul Mac', async () => {
  const r = await request(createApp({config, dataStamp: () => ({osm: 'X'})}))
    .get('/v1/s/profiles');
  expect(r.status).toBe(200);
});
it('una richiesta non autorizzata non consuma il secchio di qualcun altro', async () => {
  // il secchio di prova ha capienza 1: se il controllo venisse dopo il limite,
  // le due richieste respinte lo svuoterebbero e la terza sarebbe 429
  const a = withToken((_req, res) => res.json({ok: true}));
  expect((await request(a).post('/v1/s/route').send({})).status).toBe(401);
  expect((await request(a).post('/v1/s/route').set('Authorization', 'Bearer no').send({})).status).toBe(401);
  expect((await request(a).post('/v1/s/route')
    .set('Authorization', `Bearer ${TOKEN}`).send({})).status).toBe(200);
});
it('il token non compare nei log', async () => {
  const scritti = [];
  const orig = process.stdout.write;
  process.stdout.write = c => { scritti.push(String(c)); return true; };
  try {
    const a = withToken((_req, res) => res.json({ok: true}));
    await request(a).post('/v1/s/route').set('Authorization', `Bearer ${TOKEN}`).send({});
    await request(withToken((_req, res) => res.json({ok: true})))
      .post('/v1/s/route').set('Authorization', 'Bearer token-sbagliato-999').send({});
  } finally { process.stdout.write = orig; }
  const log = scritti.join('');
  expect(log).not.toContain(TOKEN);
  expect(log).not.toContain('token-sbagliato-999');
  expect(log).not.toContain('Bearer');
});

import {it, expect, vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import request from 'supertest';
import Database from 'better-sqlite3';
import {loadConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import {makePoiHandler} from '../src/poi-handler.js';

const config = loadConfig(new URL('../config', import.meta.url).pathname);
const dir = mkdtempSync(join(tmpdir(), 'wm-poi-route-'));

// connessione in sola lettura, come waysDb in server.js
function fixtureDb(rows, {conTabella = true} = {}) {
  const path = join(dir, `poi-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new Database(path);
  if (conTabella) {
    db.exec('create table poi (osm_id integer primary key, name text, kind text,' +
      ' ele real, lon real, lat real, wikipedia text, wikidata text)');
    const ins = db.prepare('insert into poi values (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of rows) ins.run(...r);
  } else db.exec('create table ways (way_id integer primary key)');
  db.close();
  return new Database(path, {readonly: true});
}

const vicino = [1, 'Monte Prova', 'peak', 917, 10.501, 43.751, 'it:Monte Prova', 'Q1'];
const senzaWiki = [2, 'Fonte di Prova', 'drinking_water', 300, 10.502, 43.750, null, null];
const lontano = [3, 'Cima Lontana', 'peak', 1000, 10.6, 43.9, null, null];

const app = (waysDb = fixtureDb([vicino, senzaWiki, lontano])) =>
  createApp({config, dataStamp: () => ({osm: 'X'}), handlers: {poi: makePoiHandler({waysDb})}});

it('restituisce i POI entro il raggio, ordinati per distanza', async () => {
  const r = await request(app()).get('/v1/walkiria/poi').query({lon: 10.5, lat: 43.75, radiusM: 500});
  expect(r.status).toBe(200);
  expect(r.body.poi.map(p => p.name)).toEqual(['Monte Prova', 'Fonte di Prova']);
  expect(r.body.poi[0]).toMatchObject({kind: 'peak', ele: 917, osmId: 1, wikidata: 'Q1'});
});

it('coordinate non valide: 400 con lo stesso stato del tool', async () => {
  const r = await request(app()).get('/v1/walkiria/poi').query({lon: 'x', lat: 43.75});
  expect(r.status).toBe(400);
  expect(r.body).toEqual({stato: 'coordinate_non_valide'});
});

it('coordinata vuota o assente: 400, non il punto (0, 0)', async () => {
  const a = await request(app()).get('/v1/walkiria/poi?lon=&lat=43.75');
  expect(a.status).toBe(400);
  const b = await request(app()).get('/v1/walkiria/poi').query({lon: 10.5});
  expect(b.status).toBe(400);
});

it('raggio mancante: vale il default di 500 metri', async () => {
  const r = await request(app()).get('/v1/walkiria/poi').query({lon: 10.5, lat: 43.75});
  expect(r.status).toBe(200);
  expect(r.body.poi.map(p => p.name)).toEqual(['Monte Prova', 'Fonte di Prova']);
});

it('il raggio in query string arriva alla ricerca: 150 m lascia solo il piu vicino', async () => {
  const r = await request(app()).get('/v1/walkiria/poi').query({lon: 10.5, lat: 43.75, radiusM: 150});
  expect(r.body.poi.map(p => p.name)).toEqual(['Monte Prova']);
});

it('nessun risultato nel raggio: lista vuota, non 404', async () => {
  const r = await request(app()).get('/v1/walkiria/poi').query({lon: 11.9, lat: 43.99, radiusM: 10});
  expect(r.status).toBe(200);
  expect(r.body.poi).toEqual([]);
});

it('grafo senza tabella poi: 200 con lista vuota dichiarata', async () => {
  const r = await request(app(fixtureDb([], {conTabella: false}))).get('/v1/walkiria/poi').query({lon: 10.5, lat: 43.75});
  expect(r.status).toBe(200);
  expect(r.body).toEqual({poi: [], vuoto: 'dati senza POI: grafo da rigenerare'});
});

it('shard sconosciuto: 404, come le altre rotte /v1', async () => {
  const r = await request(app()).get('/v1/inesistente/poi').query({lon: 10.5, lat: 43.75});
  expect(r.status).toBe(404);
});

it('nessuna coordinata ne raggio nei log', async () => {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await request(app()).get('/v1/walkiria/poi').query({lon: 10.5123456, lat: 43.7512345, radiusM: 7771});
    await new Promise(r => setTimeout(r, 20));
    const logged = out.mock.calls.map(c => String(c[0])).join('');
    expect(logged).toContain('/poi"');   // la chiamata e' registrata davvero
    expect(logged).not.toMatch(/10\.51|43\.75|7771|lon|lat/);
  } finally { out.mockRestore(); }
});

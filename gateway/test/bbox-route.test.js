import {it, expect, vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import request from 'supertest';
import Database from 'better-sqlite3';
import {loadConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import {makePlacesHandler, makeAreasHandler} from '../src/bbox-handler.js';

const config = loadConfig(new URL('../config', import.meta.url).pathname);
const dir = mkdtempSync(join(tmpdir(), 'wm-bbox-route-'));

// connessione in sola lettura, come waysDb in server.js
function fixtureDb({places = [], areas = []} = {}) {
  const path = join(dir, `bbox-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new Database(path);
  db.exec('create table poi (osm_id integer primary key, name text, kind text,' +
    ' ele real, lon real, lat real, wikipedia text, wikidata text)');
  db.exec('create table area (osm_type text, osm_id integer, name text, kind text,' +
    ' min_lon real, min_lat real, max_lon real, max_lat real)');
  const insP = db.prepare('insert into poi values (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of places) insP.run(...r);
  const insA = db.prepare('insert into area values (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of areas) insA.run(...r);
  db.close();
  return new Database(path, {readonly: true});
}

const places = [
  [1, 'Borgo Uno', 'town', null, 10.5, 43.75, null, null],
  [2, 'Cima Due', 'peak', 900, 10.52, 43.76, null, null],
  [3, 'Citta Lontana', 'city', null, 12.0, 45.0, null, null],
];
const areas = [
  ['relation', 10, 'Toscana', 'region', 9.7, 42.2, 12.4, 44.5],
  ['relation', 11, 'Veneto', 'region', 10.6, 44.8, 13.1, 46.7],
  ['relation', 20, 'Zona Prova', 'zone', 10.4, 43.7, 10.6, 43.8],
];

const app = (waysDb = fixtureDb({places, areas})) =>
  createApp({config, dataStamp: () => ({osm: 'X'}),
    handlers: {places: makePlacesHandler({waysDb}), areas: makeAreasHandler({waysDb})}});

const BBOX = '10.4,43.7,10.6,43.8';

it('/places: 200 con i luoghi dentro il bbox', async () => {
  const r = await request(app()).get('/v1/walkiria/places').query({bbox: BBOX});
  expect(r.status).toBe(200);
  expect(r.body.places.map(p => p.name)).toEqual(['Borgo Uno', 'Cima Due']);
});

it('/places: kinds separati da virgola filtrano per tipo', async () => {
  const r = await request(app()).get('/v1/walkiria/places').query({bbox: '9,42,13,46', kinds: 'city,town'});
  expect(r.body.places.map(p => p.name)).toEqual(['Borgo Uno', 'Citta Lontana']);
});

it('/places: limit in query string taglia e dichiara il taglio', async () => {
  const r = await request(app()).get('/v1/walkiria/places').query({bbox: '9,42,13,46', limit: 2});
  expect(r.body.places).toHaveLength(2);
  expect(r.body.troncato).toBe(true);
});

it('/places: il default di limit e 200, il tetto 2000', async () => {
  const many = Array.from({length: 2105}, (_, i) => [i + 1, `P${String(i).padStart(4, '0')}`, 'town', null, 10.5, 43.75, null, null]);
  const a = app(fixtureDb({places: many}));
  const d = await request(a).get('/v1/walkiria/places').query({bbox: BBOX});
  expect(d.body.places).toHaveLength(200);
  expect(d.body.troncato).toBe(true);
  const t = await request(a).get('/v1/walkiria/places').query({bbox: BBOX, limit: 999999});
  expect(t.body.places).toHaveLength(2000);
});

it('/places: bbox assente o malformato: 400 bbox_non_valido', async () => {
  for (const q of ['', '?bbox=', '?bbox=1,2,3', '?bbox=a,b,c,d', '?bbox=10.6,43.8,10.4,43.7']) {
    const r = await request(app()).get('/v1/walkiria/places' + q);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({stato: 'bbox_non_valido'});
  }
});

it('/places: nessun luogo nel bbox: 200 con vuoto dichiarato', async () => {
  const r = await request(app()).get('/v1/walkiria/places').query({bbox: '0,0,1,1'});
  expect(r.status).toBe(200);
  expect(r.body).toEqual({places: [], vuoto: 'nessun luogo nel bbox'});
});

it('/areas: 200 con le aree del tipo che intersecano il bbox', async () => {
  const r = await request(app()).get('/v1/walkiria/areas').query({kind: 'region', bbox: BBOX});
  expect(r.status).toBe(200);
  expect(r.body.areas.map(a => a.name)).toEqual(['Toscana']);
});

it('/areas: senza bbox tutte le aree di quel tipo', async () => {
  const r = await request(app()).get('/v1/walkiria/areas').query({kind: 'region'});
  expect(r.status).toBe(200);
  expect(r.body.areas.map(a => a.name)).toEqual(['Toscana', 'Veneto']);
});

it('/areas: bbox presente ma malformato: 400 bbox_non_valido', async () => {
  const r = await request(app()).get('/v1/walkiria/areas').query({kind: 'zone', bbox: '1,2,3'});
  expect(r.status).toBe(400);
  expect(r.body).toEqual({stato: 'bbox_non_valido'});
});

it('/areas: kind sconosciuto o assente: 400', async () => {
  const a = await request(app()).get('/v1/walkiria/areas').query({kind: 'continent'});
  expect(a.status).toBe(400);
  expect(a.body).toEqual({stato: 'kind_non_valido'});
  const b = await request(app()).get('/v1/walkiria/areas');
  expect(b.status).toBe(400);
});

it('shard sconosciuto: 404, come le altre rotte /v1', async () => {
  const a = await request(app()).get('/v1/inesistente/places').query({bbox: BBOX});
  expect(a.status).toBe(404);
  const b = await request(app()).get('/v1/inesistente/areas').query({kind: 'zone'});
  expect(b.status).toBe(404);
});

it('nessun bbox ne parametro nei log', async () => {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    const a = app();
    await request(a).get('/v1/walkiria/places').query({bbox: '10.4123,43.7123,10.6123,43.8123', kinds: 'town', limit: 7771});
    await request(a).get('/v1/walkiria/areas').query({kind: 'zone', bbox: '10.4123,43.7123,10.6123,43.8123'});
    await new Promise(r => setTimeout(r, 20));
    const logged = out.mock.calls.map(c => String(c[0])).join('');
    expect(logged).toContain('/places"');   // le chiamate sono registrate davvero
    expect(logged).toContain('/areas"');
    expect(logged).not.toMatch(/10\.4|43\.7|10\.6|43\.8|7771|bbox|lon|lat|town|zone/);
  } finally { out.mockRestore(); }
});

it('/areas passa a chi cerca il limit dichiarato nella query string', async () => {
  // la fixture ha due region: con limit 1 ne torna una e il taglio si dichiara
  const r = await request(app()).get('/v1/walkiria/areas').query({kind: 'region', limit: 1});
  expect(r.status).toBe(200);
  expect(r.body.areas).toHaveLength(1);
  expect(r.body.troncato).toBe(true);
});

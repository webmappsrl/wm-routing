import {it, expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {makePoiNearbyTool} from '../src/mcp/poi.js';

const dir = mkdtempSync(join(tmpdir(), 'wm-poi-'));

function fixtureDb(rows) {
  const path = join(dir, `poi-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new Database(path);
  db.exec('create table poi (osm_id integer primary key, name text, kind text,' +
    ' ele real, lon real, lat real, wikipedia text, wikidata text)');
  const ins = db.prepare('insert into poi values (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of rows) ins.run(...r);
  db.close();
  return path;
}

const CENTRO = [10.5, 43.75];
const vicino = [1, 'Monte Prova', 'peak', 917, 10.501, 43.751, 'it:Monte Prova', 'Q1'];
const senzaWiki = [2, 'Fonte di Prova', 'drinking_water', 300, 10.502, 43.750, null, null];
const lontano = [3, 'Cima Lontana', 'peak', 1000, 10.6, 43.9, null, null];

it('trova i POI entro il raggio, ordinati per distanza, con i soli identificatori wiki', () => {
  const tool = makePoiNearbyTool({waysDbPath: fixtureDb([vicino, senzaWiki, lontano])});
  const r = tool({point: CENTRO, radiusM: 500});
  expect(r.poi.map(p => p.name)).toEqual(['Monte Prova', 'Fonte di Prova']);
  expect(r.poi[0]).toMatchObject({kind: 'peak', ele: 917, osmId: 1, wikipedia: 'it:Monte Prova', wikidata: 'Q1'});
  expect(r.poi[1].wikipedia).toBeUndefined();
  expect(JSON.stringify(r)).not.toMatch(/horse/i);
});

it('fuori raggio: risposta vuota dichiarata, non errore', () => {
  const tool = makePoiNearbyTool({waysDbPath: fixtureDb([lontano])});
  const r = tool({point: CENTRO, radiusM: 500});
  expect(r.poi).toEqual([]);
  expect(r.vuoto).toContain('nessun POI');
});

it('ways.sqlite vecchio senza tabella poi: lo dice, senza eccezione', () => {
  const path = join(dir, 'vecchio.sqlite');
  const db = new Database(path);
  db.exec('create table ways (way_id integer primary key)');
  db.close();
  const r = makePoiNearbyTool({waysDbPath: path})({point: CENTRO});
  expect(r.poi).toEqual([]);
  expect(r.vuoto).toContain('rigenerare');
});

it('file del tutto assente: stessa risposta dichiarata', () => {
  const r = makePoiNearbyTool({waysDbPath: join(dir, 'non-esiste.sqlite')})({point: CENTRO});
  expect(r.poi).toEqual([]);
  expect(r.vuoto).toContain('rigenerare');
});

it('coordinate non valide: stato chiaro', () => {
  const tool = makePoiNearbyTool({waysDbPath: fixtureDb([vicino])});
  expect(tool({point: ['x', 43]}).stato).toBe('coordinate_non_valide');
});

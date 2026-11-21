import {describe, it, expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {parseBbox, searchPlacesInBbox, searchAreasInBbox} from '../src/bbox-search.js';

const dir = mkdtempSync(join(tmpdir(), 'wm-bbox-search-'));

// base dati vera su disco, poi riaperta in sola lettura come fa il gateway
function fixtureDb({poi = [], area = []} = {}, {withPoi = true, withArea = true} = {}) {
  const path = join(dir, `bbox-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new Database(path);
  db.exec('create table ways (way_id integer primary key)');
  if (withPoi) {
    db.exec('create table poi (osm_id integer primary key, name text, kind text,' +
      ' ele real, lon real, lat real, wikipedia text, wikidata text)');
    const ins = db.prepare('insert into poi values (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of poi) ins.run(...r);
  }
  if (withArea) {
    db.exec('create table area (osm_type text, osm_id integer, name text, kind text,' +
      ' min_lon real, min_lat real, max_lon real, max_lat real, primary key (osm_type, osm_id))');
    const ins = db.prepare('insert into area values (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of area) ins.run(...r);
  }
  db.close();
  return new Database(path, {readonly: true});
}

const BBOX = [10.4, 43.6, 10.6, 43.8];
const pisa = [1, 'Pisa', 'city', 4, 10.5, 43.7, null, null];
const calci = [2, 'Calci', 'town', 20, 10.52, 43.72, null, null];
const vorno = [3, 'Vorno', 'locality', null, 10.45, 43.65, null, null];
const serra = [4, 'Monte Serra', 'peak', 917, 10.55, 43.75, 'it:Monte Serra', 'Q9'];
const outside = [5, 'Lucca', 'city', 19, 10.5, 43.84, null, null];

describe('parseBbox', () => {
  it('accetta quattro numeri', () => {
    expect(parseBbox('10.4,43.6,10.6,43.8')).toEqual({bbox: [10.4, 43.6, 10.6, 43.8]});
  });
  it.each([
    ['tre numeri', '10.4,43.6,10.6'],
    ['un numero non numerico', '10.4,abc,10.6,43.8'],
    ['una voce vuota', '10.4,,10.6,43.8'],
    ['e uguale a w', '10.4,43.6,10.4,43.8'],
    ['e minore di w', '10.6,43.6,10.4,43.8'],
    ['n uguale a s', '10.4,43.6,10.6,43.6'],
    ['n minore di s', '10.4,43.8,10.6,43.6'],
    ['text assente', undefined],
  ])('rifiuta %s', (_, text) => {
    expect(parseBbox(text)).toEqual({stato: 'bbox_non_valido'});
  });
});

describe('searchPlacesInBbox', () => {
  it('restituisce solo le righe dentro il bbox', () => {
    const db = fixtureDb({poi: [pisa, calci, vorno, serra, outside]});
    const r = searchPlacesInBbox(db, {bbox: BBOX});
    expect(r.places.map(p => p.name).sort()).toEqual(['Calci', 'Monte Serra', 'Pisa', 'Vorno']);
    expect(r.troncato).toBeUndefined();
    expect(r.places.find(p => p.name === 'Monte Serra'))
      .toEqual({name: 'Monte Serra', kind: 'peak', lonLat: [10.55, 43.75], ele: 917, osmId: 4});
  });

  it('con kinds city e town lascia outside locality e peak', () => {
    const db = fixtureDb({poi: [pisa, calci, vorno, serra, outside]});
    const r = searchPlacesInBbox(db, {bbox: BBOX, kinds: ['city', 'town']});
    expect(r.places.map(p => p.name).sort()).toEqual(['Calci', 'Pisa']);
  });

  it('senza kinds tornano tutti i tipi', () => {
    const db = fixtureDb({poi: [pisa, calci, vorno, serra]});
    const r = searchPlacesInBbox(db, {bbox: BBOX});
    expect(new Set(r.places.map(p => p.kind))).toEqual(new Set(['city', 'town', 'locality', 'peak']));
  });

  it('il taglio per limit e dichiarato con troncato: true', () => {
    const db = fixtureDb({poi: [pisa, calci, vorno, outside]});
    const r = searchPlacesInBbox(db, {bbox: BBOX, limit: 2});
    expect(r.places).toHaveLength(2);
    expect(r.troncato).toBe(true);
  });

  it('con esattamente limit righe non dichiara il taglio', () => {
    const db = fixtureDb({poi: [pisa, calci, vorno]});
    const r = searchPlacesInBbox(db, {bbox: BBOX, limit: 3});
    expect(r.places).toHaveLength(3);
    expect(r.troncato).toBeUndefined();
  });

  it('nessun luogo nel bbox: lista vuota dichiarata', () => {
    const db = fixtureDb({poi: [outside]});
    const r = searchPlacesInBbox(db, {bbox: BBOX});
    expect(r.places).toEqual([]);
    expect(r.vuoto).toEqual(expect.any(String));
  });

  it('bbox non valido: stato', () => {
    const db = fixtureDb({poi: [pisa]});
    expect(searchPlacesInBbox(db, {bbox: [10.6, 43.6, 10.4, 43.8]})).toEqual({stato: 'bbox_non_valido'});
    expect(searchPlacesInBbox(db, {})).toEqual({stato: 'bbox_non_valido'});
  });

  it('base dati senza la tabella poi: vuoto dichiarato', () => {
    const db = fixtureDb({}, {withPoi: false});
    expect(searchPlacesInBbox(db, {bbox: BBOX}))
      .toEqual({places: [], vuoto: 'dati senza POI: grafo da rigenerare'});
  });
});

describe('searchAreasInBbox', () => {
  const toscana = ['relation', 41977, 'Toscana', 'region', 9.6, 42.2, 12.4, 44.5];
  const liguria = ['relation', 301482, 'Liguria', 'region', 7.5, 43.7, 10.1, 44.7];
  const alpi = ['relation', 7, 'Alpi Apuane', 'zone', 10.1, 43.7, 10.4, 44.3];
  const montePisano = ['relation', 8, 'Monte Pisano', 'zone', 10.4, 43.65, 10.6, 43.8];

  it('kind region senza bbox elenca tutte le regioni, ognuna col proprio bbox', () => {
    const db = fixtureDb({area: [toscana, liguria, alpi]});
    const r = searchAreasInBbox(db, {kind: 'region'});
    expect(r.areas.map(a => a.name).sort()).toEqual(['Liguria', 'Toscana']);
    expect(r.areas.find(a => a.name === 'Toscana')).toEqual(
      {name: 'Toscana', kind: 'region', bbox: [9.6, 42.2, 12.4, 44.5], osmType: 'relation', osmId: 41977});
  });

  it('con un bbox restituisce le aree che lo intersecano, non solo le contenute', () => {
    const db = fixtureDb({area: [toscana, liguria, alpi, montePisano]});
    // Toscana contiene il bbox; Monte Pisano coincide; Liguria e separata (max_lon 10.1 < w);
    // Alpi Apuane tocca solo il bordo ovest (max_lon = w = 10.4): il bordo in comune conta
    expect(searchAreasInBbox(db, {kind: 'region', bbox: BBOX}).areas.map(a => a.name)).toEqual(['Toscana']);
    expect(searchAreasInBbox(db, {kind: 'zone', bbox: BBOX}).areas.map(a => a.name).sort())
      .toEqual(['Alpi Apuane', 'Monte Pisano']);
  });

  it('un\'area che sconfina solo in parte e inclusa', () => {
    const db = fixtureDb({area: [['relation', 9, 'Valle Lunga', 'zone', 10.55, 43.7, 11.5, 43.9]]});
    expect(searchAreasInBbox(db, {kind: 'zone', bbox: BBOX}).areas.map(a => a.name)).toEqual(['Valle Lunga']);
  });

  it('un\'area lontana e esclusa, e il kind filtra', () => {
    const db = fixtureDb({area: [toscana, liguria, montePisano]});
    expect(searchAreasInBbox(db, {kind: 'zone', bbox: BBOX}).areas.map(a => a.name)).toEqual(['Monte Pisano']);
    expect(searchAreasInBbox(db, {kind: 'region', bbox: [7.6, 44.0, 7.8, 44.2]}).areas.map(a => a.name))
      .toEqual(['Liguria']);
  });

  it('nessuna area: elenco vuoto dichiarato', () => {
    const db = fixtureDb({area: [liguria]});
    const r = searchAreasInBbox(db, {kind: 'zone', bbox: BBOX});
    expect(r.areas).toEqual([]);
    expect(r.vuoto).toEqual(expect.any(String));
  });

  it('bbox presente ma non valido: stato', () => {
    const db = fixtureDb({area: [toscana]});
    expect(searchAreasInBbox(db, {kind: 'region', bbox: [1, 2, 3]})).toEqual({stato: 'bbox_non_valido'});
  });

  it('base dati senza la tabella area: vuoto dichiarato', () => {
    const db = fixtureDb({}, {withArea: false});
    expect(searchAreasInBbox(db, {kind: 'region'}))
      .toEqual({areas: [], vuoto: 'dati senza aree: grafo da rigenerare'});
  });
});

import {it, expect} from 'vitest';
import {datiScheda} from '../src/mcp/dati-scheda.js';
import {WARNING} from '../src/route.js';

const geometry = {type: 'LineString', coordinates: [[10.1, 43.1, 100], [10.15, 43.15, 150], [10.2, 43.2, 200]]};
const route = {geometry, profile: 'libero', distanceM: 12345, ascendM: 600.4, descendM: 120,
  timeH: 4.25, segments: [{from: 0, to: 2, ref: '00', difficulty: 'T', roadClass: 'path'}],
  waypoints: [{punto: 1, distanceM: 0, timeH: 0}, {punto: 2, distanceM: 12345, timeH: 4.25}],
  warning: 'avvertenza'};
const stamp = '2026-10-08T20:21:06Z';
const blob = {points: [[10.1, 43.1], [10.2, 43.2]], profile: 'libero', stamp,
  poi: [{osmId: 1, nota: 'Cima'}, {osmId: 99, nota: 'sparito'}]};
const resolvePoi = ids => ({
  trovati: [{osmId: 1, name: 'Monte Serra', kind: 'peak', ele: 917, lon: 10.5, lat: 43.75}],
  mancanti: ids.filter(i => i !== 1),
});
const dataStamp = () => ({osm: stamp});

it('restituisce i campi della scheda, con i poi risolti', () => {
  const d = datiScheda({route, blob, resolvePoi, dataStamp});
  expect(Object.keys(d)).toEqual(['profilo', 'distanzaKm', 'salitaM', 'discesaM', 'oreDIN33466',
    'quotaMinMaxM', 'tappe', 'sentieri', 'geometry', 'stamp', 'stampCorrente', 'avvertenza',
    'poi', 'poiMancanti', 'poiNonDisponibili']);
  expect(d.distanzaKm).toBe(12.35);
  expect(d.salitaM).toBe(600);
  expect(d.tappe).toHaveLength(2);
  expect(d.geometry).toBe(geometry);
  expect(d.stamp).toBe(stamp);
  expect(d.stampCorrente).toBe(stamp);
  expect(d.avvertenza).toBe(WARNING);
  expect(d.poi).toEqual([{name: 'Monte Serra', kind: 'peak', ele: 917, lonLat: [10.5, 43.75], nota: 'Cima'}]);
  expect(d.poiMancanti).toBe(1);
  expect(d.poiNonDisponibili).toBe(false);
});

it('resolvePoi che lancia: poiNonDisponibili true e poi vuoto', () => {
  const d = datiScheda({route, blob, resolvePoi: () => { throw new Error('db'); }, dataStamp});
  expect(d.poiNonDisponibili).toBe(true);
  expect(d.poi).toEqual([]);
  expect(d.poiMancanti).toBe(0);
});

it('dataStamp che lancia: stampCorrente null, nessuna eccezione', () => {
  const d = datiScheda({route, blob, resolvePoi, dataStamp: () => { throw new Error('x'); }});
  expect(d.stampCorrente).toBeNull();
});

it('senza resolvePoi, dataStamp o poi nel blob: poi vuoto e stampCorrente null', () => {
  const d = datiScheda({route, blob: {...blob, poi: undefined}});
  expect(d.poi).toEqual([]);
  expect(d.poiNonDisponibili).toBe(false);
  expect(d.stampCorrente).toBeNull();
});

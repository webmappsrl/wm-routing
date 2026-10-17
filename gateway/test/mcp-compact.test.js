import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {compactRoute} from '../src/mcp/compact.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/v1-route.json', import.meta.url)));
const out = () => compactRoute(fixture);

it('riporta i totali della risposta /v1, arrotondati', () => {
  const o = out();
  expect(o.distanzaKm).toBe(+(fixture.distanceM / 1000).toFixed(2));
  expect(o.salitaM).toBe(Math.round(fixture.ascendM));
  expect(o.discesaM).toBe(Math.round(fixture.descendM));
  expect(o.oreDIN33466).toBe(+fixture.timeH.toFixed(2));
  expect(o.profilo).toBe('escursionista');
});

it('aggrega i sentieri per ref con km decrescenti, e il 135 c\'e\'', () => {
  const s = out().sentieri;
  expect(s.length).toBeGreaterThan(0);
  for (let i = 1; i < s.length; i++) expect(s[i].km).toBeLessThanOrEqual(s[i - 1].km);
  expect(s.some(x => x.ref.split(';').includes('135'))).toBe(true);
});

it('campiona la geometria a non piu\' di 26 punti [lon, lat, quota]', () => {
  const g = out().geometriaCampione;
  expect(g.length).toBeLessThanOrEqual(26);
  for (const p of g) { expect(p).toHaveLength(3); for (const n of p) expect(typeof n).toBe('number'); }
});

it('ha una tappa per waypoint, con km e ore cumulate', () => {
  const t = out().tappe;
  expect(t).toHaveLength(fixture.waypoints.length);
  expect(t.at(-1).kmDallaPartenza).toBe(+(fixture.waypoints.at(-1).distanceM / 1000).toFixed(2));
  for (const x of t) { expect(x).toHaveProperty('punto'); expect(x).toHaveProperty('oreDallaPartenza'); }
});

it('i tratti calcolati con un altro profilo (fallback) finiscono negli avvisi', () => {
  const withFb = compactRoute({...fixture, fallbackLegs: [{from: 1, to: 2, profile: 'esperto'}]});
  expect(withFb.avvisi.trattiConAltroProfilo).toEqual([{daPunto: 1, aPunto: 2, profilo: 'esperto'}]);
  expect(out().avvisi.trattiConAltroProfilo).toEqual([]);
});

it('non fa passare la risposta grezza ne\' horse', () => {
  const o = out();
  expect(o).not.toHaveProperty('geometry');
  expect(o).not.toHaveProperty('segments');
  expect(JSON.stringify(o)).not.toMatch(/horse/i);
  expect(o.avvisi.warning).toBe(fixture.warning);
});

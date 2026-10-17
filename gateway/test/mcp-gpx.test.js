import {it, expect} from 'vitest';
import {toGpx} from '../src/mcp/gpx.js';

const geometry = {type: 'LineString', coordinates: [
  [10.442, 43.7625, 10.5], [10.45, 43.75, 120], [10.5503, 43.7521, 846.9],
]};
const points = [[10.442, 43.7625], [10.5503, 43.7521]];
const gpx = () => toGpx({geometry, points, profile: 'libero', stamp: '2026-10-08T20:21:06Z'});

it('produce un GPX 1.1 che inizia con la dichiarazione xml', () => {
  expect(gpx().startsWith('<?xml')).toBe(true);
  expect(gpx()).toContain('<gpx version="1.1"');
});

it('ha un trkpt con quota per ogni punto della geometria', () => {
  const g = gpx();
  expect(g.match(/<trkpt /g)).toHaveLength(3);
  expect(g.match(/<ele>/g)).toHaveLength(3);
  expect(g).toContain('<ele>846.9</ele>');
});

it('ha un wpt per ogni punto richiesto', () => {
  expect(gpx().match(/<wpt /g)).toHaveLength(2);
});

it('porta nel metadata la data dei dati e l\'avvertenza del servizio', () => {
  const g = gpx();
  expect(g).toContain('2026-10-08T20:21:06Z');
  expect(g).toContain('<metadata>');
  expect(g).toMatch(/percorribilit/);
});

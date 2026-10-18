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

const poi = [
  {name: 'Monte Serra', lon: 10.5, lat: 43.75, ele: 917, nota: 'Cima con vista sul Tirreno'},
  {name: "Scarpa d'Orlando", lon: 10.46, lat: 43.76, ele: null, nota: 'Fontana lungo il sentiero'},
];
const withPoi = (p = poi) => toGpx({geometry, points, profile: 'libero', stamp: 'S', poi: p});

it('senza poi il GPX e\' identico a quello di oggi', () => {
  const base = toGpx({geometry, points, profile: 'libero', stamp: 'S'});
  expect(toGpx({geometry, points, profile: 'libero', stamp: 'S', poi: []})).toBe(base);
  expect(toGpx({geometry, points, profile: 'libero', stamp: 'S', poi: undefined})).toBe(base);
});

it('ogni poi e\' un wpt in piu\' con nome e nota in desc; i punti restano Punto N', () => {
  const g = withPoi();
  expect(g.match(/<wpt /g)).toHaveLength(4);
  expect(g).toContain('<name>Punto 1</name>');
  expect(g).toContain('<name>Monte Serra</name>');
  expect(g).toContain('<desc>Cima con vista sul Tirreno</desc>');
});

it('la quota c\'e\' quando nota, e non si scrive mai un ele vuoto', () => {
  const g = withPoi();
  expect(g).toContain('<ele>917</ele>');
  const fontana = g.split('<wpt ').find(s => s.includes('Orlando')).split('</wpt>')[0];
  expect(fontana).not.toContain('<ele');
  expect(g).not.toMatch(/<ele><\/ele>|<ele>null|<ele>NaN/);
});

it('senza nota non scrive desc', () => {
  const g = withPoi([{name: 'X', lon: 10.5, lat: 43.7, ele: 5, nota: ''}]);
  expect(g.split('<wpt ').pop().split('</wpt>')[0]).not.toContain('<desc');
});

it('nome e nota con & < > e apici escono con l\'escaping', () => {
  const g = withPoi([{name: 'Bar <"A&B">', lon: 10.5, lat: 43.7, ele: 1, nota: `a & b < c > d 'e' "f"`}]);
  expect(g).toContain('<name>Bar &lt;&quot;A&amp;B&quot;&gt;</name>');
  expect(g).toContain('<desc>a &amp; b &lt; c &gt; d &apos;e&apos; &quot;f&quot;</desc>');
});

it('i caratteri di controllo non ammessi in XML sono tolti dal testo dei poi', () => {
  const g = withPoi([{name: 'A\u0000B\u001F', lon: 10.5, lat: 43.7, ele: 1, nota: 'x\u0008y'}]);
  expect(g).toContain('<name>AB</name>');
  expect(g).toContain('<desc>xy</desc>');
});

// --- attribuzione del testo scritto dall'assistente ---
const metaDesc = g => g.match(/<metadata>[\s\S]*?<desc>([\s\S]*?)<\/desc>/)[1];

it('con poi che hanno una nota, il metadata dice che le note sono dell\'assistente (una volta sola)', () => {
  const g = withPoi();
  expect(metaDesc(g)).toMatch(/note dei punti sono scritte dall.assistente/);
  expect(g.match(/scritte dall.assistente/g)).toHaveLength(1);
});

it('con poi senza nessuna nota, il metadata resta quello di sempre', () => {
  const senzaNote = [{name: 'Monte Serra', lon: 10.5, lat: 43.75, ele: 917}];
  const base = toGpx({geometry, points, profile: 'libero', stamp: 'S'});
  expect(toGpx({geometry, points, profile: 'libero', stamp: 'S', poi: senzaNote})).not.toMatch(/assistente/);
  expect(base).not.toMatch(/assistente/);
});

it('poiNonDisponibili: il metadata lo dichiara; senza il flag niente', () => {
  const g = toGpx({geometry, points, profile: 'libero', stamp: 'S', poiNonDisponibili: true});
  expect(metaDesc(g)).toMatch(/punti di interesse non erano disponibili/);
  expect(toGpx({geometry, points, profile: 'libero', stamp: 'S'})).not.toMatch(/non erano disponibili/);
});

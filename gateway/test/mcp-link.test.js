import {it, expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {encodeLink, decodeLink} from '../src/mcp/link.js';

const key = 'chiave-di-prova';
const data = {points: [[10.442, 43.7625], [10.5503, 43.7521]], profile: 'libero', stamp: '2026-10-08T20:21:06Z'};
const thrown = f => { try { f(); } catch (e) { return e; } return null; };

it('decodifica quello che codifica: punti, profilo e stamp identici', () => {
  const out = decodeLink(encodeLink(data, key), key);
  expect(out.points).toEqual([[10.442, 43.7625], [10.5503, 43.7521]]);
  expect(out.profile).toBe('libero');
  expect(out.stamp).toBe('2026-10-08T20:21:06Z');
});

it('rifiuta un blob con un carattere alterato', () => {
  const blob = encodeLink(data, key);
  const altered = blob.slice(0, 10) + (blob[10] === 'A' ? 'B' : 'A') + blob.slice(11);
  expect(thrown(() => decodeLink(altered, key))?.stato).toBe('firma_non_valida');
});

it('rifiuta un blob troncato', () => {
  const blob = encodeLink(data, key);
  expect(thrown(() => decodeLink(blob.slice(0, -8), key))?.stato).toBe('firma_non_valida');
});

it('rifiuta un blob firmato con un\'altra chiave', () => {
  const blob = encodeLink(data, 'altra-chiave');
  expect(thrown(() => decodeLink(blob, key))?.stato).toBe('firma_non_valida');
});

// --- POI come soli identificatori (osmId + nota normalizzata) ---
// osmId reale: intero sicuro (vedi resolvePoi); 13 cifre nel test di lunghezza.
const poi2 = [{osmId: 123456789, nota: 'rifugio, acqua qui'}, {osmId: 987654321, nota: ''}];

it('round-trip con 2 POI: osmId e note identici', () => {
  const out = decodeLink(encodeLink({...data, poi: poi2}, key), key);
  expect(out.poi).toEqual([{osmId: 123456789, nota: 'rifugio, acqua qui'}, {osmId: 987654321, nota: ''}]);
});

it('blob scritto senza poi (link già consegnati): decodifica con poi vuoto', () => {
  const out = decodeLink(encodeLink(data, key), key);
  expect(out.poi).toEqual([]);
  expect(out.points).toEqual([[10.442, 43.7625], [10.5503, 43.7521]]);
});

it('21 POI: LinkError troppi_poi', () => {
  const poi = Array.from({length: 21}, (_, i) => ({osmId: i + 1}));
  expect(thrown(() => encodeLink({...data, poi}, key))?.stato).toBe('troppi_poi');
});

it('nota con a capo e 200 caratteri: una riga sola di 80', () => {
  const nota = 'a\nb\tc\r\n' + 'x'.repeat(200);
  const [p] = decodeLink(encodeLink({...data, poi: [{osmId: 1, nota}]}, key), key).poi;
  expect(p.nota).not.toMatch(/[\r\n\t]/);
  expect(p.nota.length).toBe(80);
  expect(p.nota.startsWith('a b c')).toBe(true);
  const [q] = decodeLink(encodeLink({...data, poi: [{osmId: 1, nota: '\n' + 'y'.repeat(200)}]}, key), key).poi;
  expect(q.nota).toBe('y'.repeat(80));
});

it('POI manomesso (osmId cambiato, vecchia firma): firma_non_valida', () => {
  const blob = encodeLink({...data, poi: poi2}, key);
  const [payload, sig] = blob.split('.');
  const j = JSON.parse(Buffer.from(payload, 'base64url').toString());
  j.poi[0].i = 111111111;
  const forged = `${Buffer.from(JSON.stringify(j)).toString('base64url')}.${sig}`;
  expect(thrown(() => decodeLink(forged, key))?.stato).toBe('firma_non_valida');
});

it('20 POI con note piene: blob misurato sotto i 4000 caratteri', () => {
  const poi = Array.from({length: 20}, (_, i) => ({osmId: 1000000000000 + i * 7919, nota: ('nota piena ' + i + ' ').padEnd(80, 'z')}));
  const blob = encodeLink({points: Array.from({length: 6}, (_, i) => [10.442 + i / 100, 43.7625 + i / 100]), profile: 'libero', stamp: '2026-10-08T20:21:06Z', poi}, key);
  expect(decodeLink(blob, key).poi.length).toBe(20);
  expect(blob.length).toBeLessThan(4000);
});

it('osmId non intero: LinkError poi_non_valido', () => {
  expect(thrown(() => encodeLink({...data, poi: [{osmId: 'Rifugio X'}]}, key))?.stato).toBe('poi_non_valido');
});

// Blob firmato a mano con la chiave giusta: la forma dei POI non e' garantita dall'encoder.
const signed = body => {
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${payload}.${createHmac('sha256', key).update(payload).digest().subarray(0, 16).toString('base64url')}`;
};
const base = {p: [[10.442, 43.7625]], pr: 'libero', d: 's'};

it.each([
  ['elemento null', [null]],
  ['i stringa', [{i: '123', n: ''}]],
  ['i null', [{i: null, n: ''}]],
  ['i oggetto', [{i: {}, n: ''}]],
  ['n oggetto', [{i: 1, n: {}}]],
  ['n numero', [{i: 1, n: 5}]],
  ['n assente', [{i: 1}]],
  ['elemento vuoto', [{}]],
  ['poi non array (stringa)', 'abc'],
  ['poi non array (oggetto)', {i: 1, n: ''}],
  ['poi null', null],
])('blob firmato con forma strana (%s): firma_non_valida', (_, poi) => {
  expect(thrown(() => decodeLink(signed({...base, poi}), key))?.stato).toBe('firma_non_valida');
});

it('decode ri-normalizza la nota di un blob firmato a mano', () => {
  const out = decodeLink(signed({...base, poi: [{i: 1, n: 'a\nb' + 'x'.repeat(200)}]}), key);
  expect(out.poi[0].nota.length).toBe(80);
  expect(out.poi[0].nota).not.toMatch(/\n/);
});

it.each([['stringa', 'abc'], ['numero', 5], ['oggetto', {}]])('encodeLink con poi %s: poi_non_valido', (_, poi) => {
  expect(thrown(() => encodeLink({...data, poi}, key))?.stato).toBe('poi_non_valido');
});

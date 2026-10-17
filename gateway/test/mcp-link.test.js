import {it, expect} from 'vitest';
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

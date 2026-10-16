import {it, expect} from 'vitest';
import {haversineM, trackLengthM, project, pointAtM, candidates, meanDistanceM} from '../src/rejoin/geometry.js';

const A = [10, 44], B = [10.01, 44];
const outAndBack = [A, B, A];

it('lunghezza', () => {
  expect(trackLengthM([A, B])).toBeCloseTo(haversineM(A, B), 3);
  expect(haversineM(A, B)).toBeGreaterThan(790);
  expect(haversineM(A, B)).toBeLessThan(810);
});
it('andata e ritorno: la proiezione segue il punto raggiunto', () => {
  const p = [10.005, 44.001];
  const L = haversineM(A, B);
  expect(project(outAndBack, p, 0).alongM).toBeCloseTo(L / 2, -1);
  expect(project(outAndBack, p, L).alongM).toBeCloseTo(L * 1.5, -1);
  expect(project(outAndBack, p, 0).distanceM).toBeCloseTo(111, -1);
});
it('un progresso oltre la fine si limita alla fine', () => {
  const L = trackLengthM(outAndBack);
  expect(project(outAndBack, [10, 44.001], L * 3).alongM).toBeCloseTo(L, 3);
});
it('candidati in avanti e indietro, entro la traccia', () => {
  const L = haversineM(A, B);
  expect(candidates([A, B], 100, [0, 500, 1000], 'forward').map(c => Math.round(c.alongM)))
    .toEqual([100, 600, Math.round(L)]);
  expect(candidates([A, B], 700, [0, 500, 1000], 'backward').map(c => Math.round(c.alongM)))
    .toEqual([700, 200, 0]);
  expect(pointAtM([A, B], 0)).toEqual(A);
});
it('distanza media fra due linee', () => {
  expect(meanDistanceM([A, B], [[10, 44.001], [10.01, 44.001]])).toBeCloseTo(111, -1);
});

import {it, expect} from 'vitest';
import {classify} from '../../tools/compare.mjs';

const T = {distance: 0.15, ascend: 0.2, network: 0.15};
it('nessuna differenza sotto soglia', () => {
  expect(classify({distanceM: 1000, ascendM: 100, networkShare: 0.5},
                  {distanceM: 1100, ascendM: 110, networkShare: 0.55}, T)).toEqual([]);
});
it('distanza, salita e quota su rete segnata', () => {
  expect(classify({distanceM: 1000, ascendM: 100, networkShare: 0.2},
                  {distanceM: 1300, ascendM: 200, networkShare: 0.6}, T)).toEqual(['distanza', 'salita', 'rete']);
});

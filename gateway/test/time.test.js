import {it, expect} from 'vitest';
import {hikingTimeHours} from '../src/time.js';

// DIN 33466: Th = km/4, Tv = salita/300 + discesa/500, T = max + min/2
it('piano: 8 km in 2 ore', () => {
  expect(hikingTimeHours({distanceM: 8000, ascendM: 0, descendM: 0})).toBeCloseTo(2, 5);
});
it('salita: 4 km e 600 m su: max(1, 2) + 1/2 = 2,5 ore', () => {
  expect(hikingTimeHours({distanceM: 4000, ascendM: 600, descendM: 0})).toBeCloseTo(2.5, 5);
});
it('la discesa conta', () => {
  expect(hikingTimeHours({distanceM: 4000, ascendM: 0, descendM: 1000})).toBeCloseTo(2.5, 5);
});

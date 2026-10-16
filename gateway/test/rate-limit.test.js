import {it, expect} from 'vitest';
import {createRateLimiter} from '../src/rate-limit.js';

it('esaurisce la capacita e si ricarica col tempo', () => {
  let t = 0;
  const rl = createRateLimiter({capacity: 2, perSecond: 1, now: () => t});
  expect(rl.take('a')).toBe(true);
  expect(rl.take('a')).toBe(true);
  expect(rl.take('a')).toBe(false);
  expect(rl.take('b')).toBe(true);   // chiavi indipendenti
  t = 1000;
  expect(rl.take('a')).toBe(true);
});

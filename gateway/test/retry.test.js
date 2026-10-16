import {it, expect} from 'vitest';
import {withRetry} from '../src/retry.js';

const sleep = async () => {};
it('ripete finche il motore torna su', async () => {
  let n = 0;
  const r = await withRetry(async () => {
    if (++n < 3) throw new Error('ECONNREFUSED');
    return {ok: true, status: 200};
  }, {timeoutMs: 60000, stepMs: 1000, sleep});
  expect(r.ok).toBe(true);
  expect(n).toBe(3);
});
it('oltre il tempo massimo rilancia', async () => {
  let t = 0;
  const now = () => (t += 1000);
  await expect(withRetry(async () => { throw new Error('ECONNREFUSED'); },
    {timeoutMs: 5000, stepMs: 1000, sleep, now})).rejects.toThrow('ECONNREFUSED');
});
it('un 5xx conta come motore non pronto', async () => {
  let n = 0;
  const r = await withRetry(async () => (++n < 2 ? {ok: false, status: 503} : {ok: true, status: 200}),
    {timeoutMs: 60000, stepMs: 1000, sleep});
  expect(r.status).toBe(200);
});

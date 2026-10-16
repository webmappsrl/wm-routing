import {it, expect, vi} from 'vitest';
import {logEvent} from '../src/log.js';

it('scrive solo i campi ammessi e toglie i numeri decimali dagli errori', () => {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  logEvent({route: '/v1/:shard/rejoin', status: 200, ms: 12, shard: 'webmapp', profile: 'mtb',
            body: {position: [10.123456, 44.654321]}, error: 'punto 44.654321,10.123456 non trovato'});
  const line = out.mock.calls.at(-1)[0];
  out.mockRestore();
  expect(line).toContain('"status":200');
  expect(line).not.toContain('44.654321');
  expect(line).not.toContain('10.123456');
  expect(line).not.toContain('body');
});
it('un errore inatteso del gateway finisce nel log, senza coordinate', async () => {
  const {sendError} = await import('../src/route.js');
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const res = {status() { return this; }, json() { return this; }};
  sendError(res, new TypeError('lettura di 44.654321 fallita'));
  const line = out.mock.calls.at(-1)?.[0] ?? '';
  out.mockRestore();
  expect(line).toContain('lettura di <n> fallita');
});

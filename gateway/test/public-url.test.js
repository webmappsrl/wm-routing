import {it, expect} from 'vitest';
import {publicUrlDi} from '../src/mcp/public-url.js';

it('variabile vuota, spazi o assente: vale l\'indirizzo locale', () => {
  for (const v of ['', '  ', undefined, null]) expect(publicUrlDi(v, 'http://127.0.0.1:8991')).toBe('http://127.0.0.1:8991');
});
it('variabile impostata: vale quella', () => {
  expect(publicUrlDi('https://r.example', 'http://127.0.0.1:8991')).toBe('https://r.example');
});

import {it, expect} from 'vitest';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readJsonFile} from '../../tools/json-file.mjs';

const dir = mkdtempSync(join(tmpdir(), 'wm-json-file-'));
const file = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };

it('un file JSON buono torna il valore letto', () => {
  expect(readJsonFile(file('ok.json', '{"nodes": 12}'))).toEqual({ok: true, value: {nodes: 12}});
});

it('un file che non esiste non si legge, e il motivo lo dice', () => {
  const r = readJsonFile(join(dir, 'non-c-e.json'));
  expect(r.ok).toBe(false);
  expect(r.reason).toContain('non-c-e.json');
});

it('un file JSON rotto non alza un\'eccezione: torna il motivo', () => {
  const r = readJsonFile(file('rotto.json', '{"nodes": 12'));
  expect(r.ok).toBe(false);
  expect(r.reason).toContain('rotto.json');
});

it('un file vuoto, che JSON.parse rifiuta, si tratta come rotto', () => {
  expect(readJsonFile(file('vuoto.json', '')).ok).toBe(false);
});

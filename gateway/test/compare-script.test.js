import {it, expect} from 'vitest';
import {mkdtempSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const COMPARE = resolve(import.meta.dirname, '../../tools/compare.mjs');

// compare.mjs legge compare/routes.json e compare/verdicts.json dal percorso
// corrente, prima di interrogare qualunque motore: con un file rotto deve
// dirlo, non morire sul parse.
function runCompare(routesText, verdictsText = '[]') {
  const dir = mkdtempSync(join(tmpdir(), 'wm-compare-'));
  mkdirSync(join(dir, 'compare'));
  writeFileSync(join(dir, 'compare/routes.json'), routesText);
  writeFileSync(join(dir, 'compare/verdicts.json'), verdictsText);
  try {
    execFileSync('node', [COMPARE], {cwd: dir, encoding: 'utf8', stdio: 'pipe'});
    return {status: 0, stderr: ''};
  } catch (e) {
    return {status: e.status, stderr: String(e.stderr)};
  }
}

it('con compare/routes.json rotto dice quale file e non lascia uno stack trace', () => {
  const r = runCompare('[{"id": "a"');
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('routes.json');
  expect(r.stderr).not.toContain('at ');
});

it('con compare/verdicts.json rotto dice quel file, non l\'altro', () => {
  const r = runCompare('[]', '{');
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('verdicts.json');
});

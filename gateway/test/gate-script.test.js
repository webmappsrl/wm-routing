import {it, expect} from 'vitest';
import {mkdtempSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const GATE = resolve(import.meta.dirname, '../../tools/gate.mjs');

// gate.mjs gira in una cartella sua, perche' legge compare/routes.json dal
// percorso corrente. Esce 3 quando blocca lo scambio: qualunque altro codice
// dice al chiamante che e' il gate a essersi rotto, non il dato a essere monco.
function runGate(routesText) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-gate-'));
  mkdirSync(join(dir, 'compare'));
  writeFileSync(join(dir, 'compare/routes.json'), routesText);
  try {
    execFileSync('node', [GATE, 'http://127.0.0.1:1', 'stamp.json', '', 'prep.json', ''],
      {cwd: dir, env: {...process.env, WM_GRAPH_BBOX: '9,43,11,45'}, encoding: 'utf8', stdio: 'pipe'});
    return {status: 0, stderr: ''};
  } catch (e) {
    return {status: e.status, stderr: String(e.stderr)};
  }
}

it('con compare/routes.json rotto il gate blocca con 3 e dice quale file', () => {
  const r = runGate('[{"id": "a", "points"');
  expect(r.status).toBe(3);
  expect(r.stderr).toContain('routes.json');
});

it('il motivo non e\' uno stack trace', () => {
  expect(runGate('[{"id": "a", "points"').stderr).not.toContain('at ');
});

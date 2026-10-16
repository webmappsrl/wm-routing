import {describe, it, expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadConfig} from '../src/config.js';

const CONF = new URL('../config', import.meta.url).pathname;
const PROFILES = new URL('../../engine/profiles', import.meta.url).pathname;

describe('configurazione', () => {
  it('ogni profilo pubblico di uno shard esiste fra i profili del motore', () => {
    const {shards, profiles} = loadConfig(CONF);
    for (const s of Object.values(shards))
      for (const engine of Object.values(s.profiles)) expect(profiles[engine]).toBeDefined();
  });
  it("l'impronta di ogni profilo coincide con i suoi custom model: cambiarli vuol dire cambiare versione", () => {
    const {profiles} = loadConfig(CONF);
    for (const [name, p] of Object.entries(profiles)) {
      const h = createHash('sha256');
      for (const f of p.files) h.update(readFileSync(join(PROFILES, f)));
      expect(p.sha256, `aggiorna sha256 e version di ${name}`).toBe(h.digest('hex'));
    }
  });
});

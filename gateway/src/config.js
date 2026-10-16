import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export function loadConfig(dir) {
  const shards = JSON.parse(readFileSync(join(dir, 'shards.json'), 'utf8'));
  const profiles = JSON.parse(readFileSync(join(dir, 'profiles.json'), 'utf8'));
  for (const [id, s] of Object.entries(shards))
    for (const engine of Object.values(s.profiles))
      if (!profiles[engine]) throw new Error(`shard ${id}: profilo del motore sconosciuto: ${engine}`);
  return {shards, profiles};
}

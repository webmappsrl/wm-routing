// Unico punto da cui il gateway scrive un log: le posizioni sono dati personali
// (CLAUDE.md, "Nessuna coordinata nei log").
const ALLOWED = ['route', 'status', 'ms', 'shard', 'profile', 'stato', 'error', 'tool'];

export function logEvent(fields) {
  const out = {t: new Date().toISOString()};
  for (const k of ALLOWED) if (fields[k] !== undefined) out[k] = fields[k];
  if (typeof out.error === 'string') out.error = out.error.replace(/-?\d+\.\d{3,}/g, '<n>');
  process.stdout.write(JSON.stringify(out) + '\n');
}

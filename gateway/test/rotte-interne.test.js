import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Fonte indipendente da INTERNI: le rotte che il gateway monta davvero, lette da
// app.js. Ogni rotta /v1/:shard/* deve essere classificata in modo esplicito: o e'
// fra i percorsi interni dello script di pubblicazione (404 da internet), o e'
// dichiarata pubblica qui sotto. Chi aggiunge una rotta deve decidere.
const APP = fileURLToPath(new URL('../src/app.js', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../infra/pubblica-routing.sh', import.meta.url));

// Rotte pubbliche di proposito (nome del segmento dopo /v1/:shard/).
const PUBLIC_ROUTES = ['profiles', 'route', 'rejoin'];

// Fuori da /v1/:shard e aperta di proposito: e' la prova di vita che lo script usa
// dopo il reload di Caddy. Non e' una rotta da classificare, ma e' elencata, cosi'
// qualunque altro percorso /v1 fuori dallo shard fa fallire il test.
const OPEN_OUTSIDE_SHARD = ['/v1/version'];

// Il middleware che risolve lo shard: non e' una rotta.
const SHARD_MIDDLEWARE = '/v1/:shard';

// L'etichetta di log del middleware (`/v1/:shard${p}`): e' una stringa, non una rotta.
const LOG_LABEL = '/v1/:shard${p}';

// Ogni stringa quotata che comincia per /v1, qualunque sia la forma della
// dichiarazione (app.get, app.post, app.use, router...). Non ci si affida alla
// forma della chiamata: se una rotta cambia aspetto, la stringa resta.
function mountedSegments(source) {
  const segments = new Set();
  const unknown = [];
  for (const m of source.matchAll(/(['"`])(\/v1[^'"`]*)\1/g)) {
    const path = m[2];
    if (OPEN_OUTSIDE_SHARD.includes(path) || path === SHARD_MIDDLEWARE || path === LOG_LABEL) continue;
    const r = /^\/v1\/:shard\/([A-Za-z0-9_-]+)\/?$/.exec(path);
    if (r) segments.add(r[1]);
    else unknown.push(path);
  }
  // Una rotta composta (`${base}/areas`, base + '/areas') non lascia una stringa
  // /v1/... intera e sfuggirebbe: se il primo argomento di una registrazione
  // nomina v1 o shard senza essere un letterale semplice, non lo si ignora.
  for (const m of source.matchAll(/\b\w+\.(?:get|post|put|patch|delete|all|use|route|head|options)\(\s*([^,;()\n]*),/g)) {
    const arg = m[1].trim();
    if (/^(['"`])[^'"`$]*\1$/.test(arg)) continue;
    if (/v1|shard/i.test(arg)) unknown.push(`${arg} (primo argomento composto)`);
  }
  return {segments, unknown};
}

function internalSegments(script) {
  const m = /^[ \t]*INTERNI=(["'])(.*?)\1[ \t]*$/m.exec(script);
  if (!m) throw new Error('assegnazione di INTERNI non riconosciuta in infra/pubblica-routing.sh: attesa una riga INTERNI="..." con i percorsi separati da spazi');
  const bySegment = new Map();
  for (const token of m[2].split(/\s+/).filter(Boolean)) {
    const r = /^\/v1\/\*\/([A-Za-z0-9_-]+)(\/?)$/.exec(token);
    if (!r) throw new Error(`voce di INTERNI non riconosciuta: "${token}" (attesa /v1/*/<nome> o /v1/*/<nome>/)`);
    const forms = bySegment.get(r[1]) ?? new Set();
    forms.add(r[2] === '/' ? 'slash' : 'plain');
    bySegment.set(r[1], forms);
  }
  return bySegment;
}

const app = readFileSync(APP, 'utf8');
const script = readFileSync(SCRIPT, 'utf8');

it('app.js: ogni percorso /v1 e\' di una forma riconosciuta', () => {
  const {segments, unknown} = mountedSegments(app);
  expect(unknown, `percorsi /v1 in app.js di forma non riconosciuta, il test non sa classificarli: ${unknown.join(', ')}`).toEqual([]);
  // Se non ne trova nessuna, il lettore e' rotto, non il gateway.
  expect(segments.size, 'nessuna rotta /v1/:shard/* trovata in app.js: il lettore non riconosce piu\' le dichiarazioni').toBeGreaterThan(0);
});

it('ogni rotta /v1/:shard/* montata e\' interna o dichiarata pubblica', () => {
  const {segments} = mountedSegments(app);
  const internal = internalSegments(script);
  const unclassified = [...segments].filter((s) => !internal.has(s) && !PUBLIC_ROUTES.includes(s));
  expect(unclassified,
    `rotte montate da app.js ne' in INTERNI ne' in PUBLIC_ROUTES: ${unclassified.join(', ')}. ` +
    'Nasconderle in infra/pubblica-routing.sh (INTERNI) o dichiararle pubbliche in questo test.').toEqual([]);
});

it('nessuna rotta e\' insieme interna e pubblica', () => {
  const internal = internalSegments(script);
  const both = PUBLIC_ROUTES.filter((s) => internal.has(s));
  expect(both, `rotte sia in INTERNI sia in PUBLIC_ROUTES: ${both.join(', ')}`).toEqual([]);
});

it('ogni rotta pubblica dichiarata esiste ancora in app.js', () => {
  const {segments} = mountedSegments(app);
  const stale = PUBLIC_ROUTES.filter((s) => !segments.has(s));
  expect(stale, `PUBLIC_ROUTES elenca rotte che app.js non monta piu': ${stale.join(', ')}`).toEqual([]);
});

it('ogni percorso interno ha entrambe le forme, con e senza slash finale', () => {
  const internal = internalSegments(script);
  const incomplete = [...internal].filter(([, f]) => f.size !== 2).map(([s]) => s);
  expect(incomplete, `percorsi di INTERNI senza una delle due forme (slash finale aggirerebbe la regola): ${incomplete.join(', ')}`).toEqual([]);
});

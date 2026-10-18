import {it, expect} from 'vitest';
import {readFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {makeRouteTool, makeFinalTool, makeMcpServer, INSTRUCTIONS} from '../src/mcp/server.js';
import {decodeLink} from '../src/mcp/link.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/v1-route.json', import.meta.url)));
const key = 'chiave-di-prova';
const base = 'http://127.0.0.1:8991';
const fakeFetch = routeReply => async url => (String(url).includes('/v1/version')
  ? {ok: true, status: 200, json: async () => ({area: [10, 43, 11, 44]})}
  : routeReply);
const okReply = {ok: true, status: 200, json: async () => fixture};
const tool = (reply = okReply) =>
  makeRouteTool({gatewayUrl: base, publicUrl: base, linkKey: key, fetchFn: fakeFetch(reply)});

it('risposta compatta con i link firmati composti dal server', async () => {
  const r = await tool()({points: [[10.5216, 43.7249], [10.5455, 43.76]], profile: 'escursionista'});
  expect(r.distanzaKm).toBe(+(fixture.distanceM / 1000).toFixed(2));
  expect(r.linkPreview).toContain('/g/?t=');
  expect(r.linkGpx).toContain('/g/gpx?t=');
  const dec = decodeLink(decodeURIComponent(r.linkPreview.split('t=')[1]), key);
  expect(dec.profile).toBe('escursionista');
  expect(dec.points).toEqual([[10.5216, 43.7249], [10.5455, 43.76]]);
  expect(dec.stamp).toBe(fixture.data.osm);
});

it('meno di due punti: stato chiaro, nessuna eccezione', async () => {
  expect((await tool()({points: [[10.5, 43.7]], profile: 'escursionista'})).stato).toBe('punti_insufficienti');
});

it('coordinate non numeriche: stato chiaro', async () => {
  expect((await tool()({points: [[10.5, 'x'], [10.6, 43.7]], profile: 'escursionista'})).stato)
    .toBe('coordinate_non_valide');
});

it('fuori area: lo dice e dichiara l\'area coperta', async () => {
  const r = await tool({ok: false, status: 400, json: async () => ({stato: 'fuori_area'})})(
    {points: [[20, 50], [20.1, 50.1]], profile: 'escursionista'});
  expect(r.stato).toBe('fuori_area');
  expect(r.avvisi.fuoriArea).toBe(true);
  expect(r.avvisi.area).toEqual([10, 43, 11, 44]);
});

it('il server MCP si costruisce con il tool registrato', () => {
  const s = makeMcpServer({gatewayUrl: base, publicUrl: base, linkKey: key});
  expect(typeof s.connect).toBe('function');
});

it('ogni chiamata tool produce una riga di log col nome del tool, senza coordinate', async () => {
  const rows = [];
  const s = makeMcpServer({gatewayUrl: base, publicUrl: base, linkKey: key,
                           fetchFn: fakeFetch(okReply), log: e => rows.push(e)});
  const tools = s._registeredTools ?? null;   // accesso interno: se cambia, usare il client in-memory
  const call = async (name, args) => (tools ? tools[name].handler(args) : null);
  await call('route', {points: [[10.5216, 43.7249], [10.5455, 43.76]], profile: 'escursionista'});
  await call('poi_nearby', {point: [10.5, 43.75]});
  expect(rows.map(r => r.tool)).toEqual(['route', 'poi_nearby']);
  for (const r of rows) expect(typeof r.ms).toBe('number');
  expect(JSON.stringify(rows)).not.toMatch(/43\.7|10\.5/);
});

it('logEvent accetta il campo tool', async () => {
  const {logEvent} = await import('../src/log.js');
  const {vi} = await import('vitest');
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  logEvent({route: '/mcp', tool: 'route', status: 200, ms: 1});
  const written = spy.mock.calls[0][0];
  spy.mockRestore();
  expect(written).toContain('"tool":"route"');
});

// --- il profilo altimetrico nel risultato del tool route ---
const PNG_FIRMA = '89504e470d0a1a0a';
const chiama = async (opts, args) => {
  const s = makeMcpServer({gatewayUrl: base, publicUrl: base, linkKey: key, ...opts});
  return s._registeredTools.route.handler(args);
};
const giro = {points: [[10.5216, 43.7249], [10.5455, 43.76]], profile: 'escursionista'};

it('route restituisce testo compatto piu\' immagine PNG del profilo', async () => {
  const res = await chiama({fetchFn: fakeFetch(okReply)}, giro);
  expect(res.content).toHaveLength(2);
  expect(res.content[0].type).toBe('text');
  expect(res.content[1].type).toBe('image');
  expect(res.content[1].mimeType).toBe('image/png');
  expect(Buffer.from(res.content[1].data, 'base64').subarray(0, 8).toString('hex')).toBe(PNG_FIRMA);
  expect(res.isError).toBeUndefined();
});

it('il JSON al modello resta compatto: niente geometria integrale ne\' immagine', async () => {
  const res = await chiama({fetchFn: fakeFetch(okReply)}, giro);
  const out = JSON.parse(res.content[0].text);
  expect(out.geometriaCampione.length).toBeLessThanOrEqual(26);
  expect(res.content[0].text.length).toBeLessThan(JSON.stringify(fixture.geometry).length / 2);
  expect(res.content[0].text).not.toContain('iVBOR');
});

it('route con errore (meno di due punti) resta senza immagine', async () => {
  const res = await chiama({fetchFn: fakeFetch(okReply)}, {points: [[10.5, 43.7]], profile: 'escursionista'});
  expect(res.content).toHaveLength(1);
  expect(res.isError).toBe(true);
});

it('se il disegno del profilo fallisce la risposta resta il testo col JSON', async () => {
  const res = await chiama({fetchFn: fakeFetch(okReply), profiloFn: () => { throw new Error('boom'); }}, giro);
  expect(res.content).toHaveLength(1);
  expect(JSON.parse(res.content[0].text).distanzaKm).toBeGreaterThan(0);
  expect(res.isError).toBeUndefined();
});

it('la riga di log esce anche quando c\'e\' l\'immagine', async () => {
  const rows = [];
  await chiama({fetchFn: fakeFetch(okReply), log: e => rows.push(e)}, giro);
  expect(rows.map(r => r.tool)).toEqual(['route']);
  expect(rows[0].status).toBe(200);
});

// --- giro_finale: i deliverable dopo la conferma ---
// database di prova temporaneo: i test non dipendono da data/ways.sqlite (fuori dal repo)
const tmp = mkdtempSync(join(tmpdir(), 'wm-final-'));
const DB = join(tmp, 'ways.sqlite');
{
  const d = new Database(DB);
  d.exec('create table poi (osm_id integer primary key, name text, kind text,' +
    ' ele real, lon real, lat real, wikipedia text, wikidata text)');
  const ins = d.prepare('insert into poi values (?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run(1733141336, 'Monte Serra', 'peak', 917, 10.5455, 43.76, null, null);
  ins.run(1304081118, "Scarpa d'Orlando", 'drinking_water', null, 10.53, 43.74, null, null);
  d.close();
}
const SERRA = 1733141336, SCARPA = 1304081118, INESISTENTE = 999999999999;
const stamp = '2026-01-01';
const fetchStamp = async url => (String(url).includes('/v1/version')
  ? {ok: true, status: 200, json: async () => ({osm: stamp, area: [10, 43, 11, 44]})} : okReply);
const finalWithStamp = () => makeFinalTool({gatewayUrl: base, publicUrl: base, linkKey: key,
  fetchFn: fetchStamp, waysDbPath: DB});
const pts = [[10.5216, 43.7249], [10.5455, 43.76]];

it('giro_finale: due osmId validi, link decodificabili con i POI e nomi dal database', async () => {
  const r = await finalWithStamp()({points: pts, profile: 'escursionista',
    poi: [{osmId: SERRA, nota: 'pranzo qui'}, {osmId: SCARPA}]});
  expect(r.poiRisolti.map(p => p.osmId)).toEqual([SERRA, SCARPA]);
  expect(r.poiRisolti[0].name).toBeTruthy();
  expect(r.poiMancanti).toEqual([]);
  expect(r.linkGpx).toContain('/g/gpx?t=');
  expect(r.linkScheda).toContain('/g/scheda?t=');
  for (const l of [r.linkGpx, r.linkScheda]) {
    const dec = decodeLink(decodeURIComponent(l.split('t=')[1]), key);
    expect(dec.poi).toEqual([{osmId: SERRA, nota: 'pranzo qui'}, {osmId: SCARPA, nota: ''}]);
    expect(dec.stamp).toBe(stamp);
  }
});

it('giro_finale: un osmId inesistente va in poiMancanti, gli altri passano', async () => {
  const r = await finalWithStamp()({points: pts, profile: 'escursionista',
    poi: [{osmId: SERRA}, {osmId: INESISTENTE}]});
  expect(r.poiMancanti).toEqual([INESISTENTE]);
  expect(r.poiRisolti.map(p => p.osmId)).toEqual([SERRA]);
  const dec = decodeLink(decodeURIComponent(r.linkGpx.split('t=')[1]), key);
  expect(dec.poi.map(p => p.osmId)).toEqual([SERRA]);
});

it('giro_finale: tutti gli osmId mancanti -> poi_non_trovati', async () => {
  const r = await finalWithStamp()({points: pts, profile: 'escursionista', poi: [{osmId: INESISTENTE}]});
  expect(r.stato).toBe('poi_non_trovati');
  expect(r.poiMancanti).toEqual([INESISTENTE]);
});

it('giro_finale: 21 POI -> troppi_poi senza eccezione', async () => {
  const poi = Array.from({length: 21}, (_, i) => ({osmId: SERRA + i}));
  expect((await finalWithStamp()({points: pts, profile: 'escursionista', poi})).stato).toBe('troppi_poi');
});

it('giro_finale: senza POI i link escono comunque; punti non validi -> stato', async () => {
  const r = await finalWithStamp()({points: pts, profile: 'escursionista'});
  expect(r.linkGpx).toBeTruthy();
  expect(r.poiRisolti).toEqual([]);
  expect((await finalWithStamp()({points: [[10, 43]], profile: 'escursionista'})).stato).toBe('punti_insufficienti');
  expect((await finalWithStamp()({points: pts, profile: 'escursionista', poi: [{osmId: 1.5}]})).stato)
    .toBe('poi_non_valido');
});

it('giro_finale: lo schema zod limita l\'array dei POI e il tool produce la sua riga di log', async () => {
  const rows = [];
  const s = makeMcpServer({gatewayUrl: base, publicUrl: base, linkKey: key, waysDbPath: DB,
                           fetchFn: fetchStamp, log: e => rows.push(e)});
  const t = s._registeredTools.giro_finale;
  expect(t).toBeTruthy();
  expect(t.description).toMatch(/poiMancanti/);
  const schema = t.inputSchema;
  const parse = v => (schema.safeParse ? schema.safeParse(v) : null);
  const base0 = {points: pts, profile: 'escursionista'};
  const big = Array.from({length: 5000}, () => ({osmId: SERRA}));
  if (parse(base0)) {
    expect(parse({...base0, poi: big}).success).toBe(false);
    expect(parse({...base0, poi: [{osmId: SERRA}]}).success).toBe(true);
  }
  const out = await t.handler({...base0, poi: [{osmId: SERRA}]});
  expect(JSON.parse(out.content[0].text).linkScheda).toBeTruthy();
  expect(rows.map(r => r.tool)).toEqual(['giro_finale']);
  expect(JSON.stringify(rows)).not.toMatch(/43\.7|10\.5/);
});

it('giro_finale: database rotto o senza tabella -> dati_non_disponibili, non poi_non_trovati', async () => {
  const args = {points: pts, profile: 'escursionista', poi: [{osmId: SERRA}]};
  const senzaTabella = join(tmp, 'vuoto.sqlite');
  new Database(senzaTabella).close();
  for (const waysDbPath of [join(tmp, 'non-esiste.sqlite'), senzaTabella]) {
    const t = makeFinalTool({gatewayUrl: base, publicUrl: base, linkKey: key, fetchFn: fetchStamp, waysDbPath});
    expect((await t(args)).stato).toBe('dati_non_disponibili');
  }
  // database sano, osmId inventato: resta poi_non_trovati
  expect((await finalWithStamp()({...args, poi: [{osmId: INESISTENTE}]})).stato).toBe('poi_non_trovati');
});

// --- Istruzioni del server: il metodo a fasi ---

// Il testo di una fase: da "\nN. " fino alla fase successiva (o al paragrafo che segue).
function fase(n) {
  const start = INSTRUCTIONS.indexOf(`\n${n}. `);
  expect(start, `fase ${n} assente`).toBeGreaterThan(-1);
  const next = INSTRUCTIONS.indexOf(`\n${n + 1}. `, start);
  const end = next > -1 ? next : INSTRUCTIONS.indexOf('\n\n', start + 1);
  return INSTRUCTIONS.slice(start, end > -1 ? end : undefined);
}

it('istruzioni: nominano i tre tool', () => {
  for (const t of ['route', 'poi_nearby', 'giro_finale']) expect(INSTRUCTIONS).toContain(t);
});

it('istruzioni: sei fasi numerate, in ordine, ciascuna col suo contenuto', () => {
  const pos = [1, 2, 3, 4, 5, 6].map(n => INSTRUCTIONS.indexOf(`\n${n}. `));
  expect(pos.every(p => p > -1)).toBe(true);
  expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  expect(INSTRUCTIONS).not.toContain('\n7. ');
  expect(fase(1)).toMatch(/vincoli/i);
  expect(fase(1)).toMatch(/data/i);
  expect(fase(1)).toMatch(/una domanda per volta/i);
  expect(fase(2)).toMatch(/stagione/i);
  expect(fase(2)).toMatch(/meteo|previsione/i);
  expect(fase(3)).toContain('route');
  expect(fase(3)).toMatch(/2-3 varianti/);
  expect(fase(4)).toContain('poi_nearby');
  expect(fase(4)).toMatch(/wikipedia/);
  expect(fase(5)).toMatch(/conferma/i);
  expect(fase(5)).not.toContain('giro_finale');
  expect(fase(6)).toContain('giro_finale');
  expect(fase(6)).toMatch(/solo dopo/i);
});

it('istruzioni: la conferma sta dopo l arricchimento e prima dell export, e le fasi 1-5 non chiamano giro_finale', () => {
  const iConf = INSTRUCTIONS.search(/conferma/i);
  expect(iConf).toBeGreaterThan(INSTRUCTIONS.indexOf('\n4. '));
  expect(iConf).toBeLessThan(INSTRUCTIONS.indexOf('\n6. '));
  for (const n of [1, 2, 3, 4, 5]) expect(fase(n)).not.toContain('giro_finale');
});

it('istruzioni: i passi si saltano se l informazione c e gia, il gate no', () => {
  expect(INSTRUCTIONS).toMatch(/salta/i);
  expect(INSTRUCTIONS).toMatch(/gate[^.]*(mai|non si salta)|(mai|non si salta)[^.]*gate/i);
});

it('istruzioni: la data si chiede e non si impone; senza data vale la stagione di oggi', () => {
  expect(fase(1)).toMatch(/non\s+(la\s+)?impo/i);
  expect(fase(2)).toMatch(/oggi/i);
  expect(fase(2)).toMatch(/luce/i);
  expect(fase(2)).toMatch(/se mi dici il giorno guardo anche la previsione/);
});

it('istruzioni: il meteo cambia la proposta (riparo o sorgente) ed e prima delle varianti', () => {
  expect(INSTRUCTIONS.indexOf('\n2. ')).toBeLessThan(INSTRUCTIONS.indexOf('\n3. '));
  expect(fase(2)).toMatch(/riparo/i);
  expect(fase(2)).toMatch(/sorgente/);
  expect(fase(2)).toContain('poi_nearby');
  expect(fase(2)).toMatch(/cambia/i);
});

it('istruzioni: oltre l orizzonte la previsione non si inventa; il servizio non da il meteo', () => {
  expect(fase(2)).toMatch(/orizzonte/i);
  expect(fase(2)).toMatch(/non (si )?inventa/i);
  expect(INSTRUCTIONS).toMatch(/non fornisce (il )?meteo/i);
  expect(INSTRUCTIONS).toMatch(/tuoi strumenti/);
});

it('istruzioni: POI come osmId, link intatti inclusa la scheda, disciplina della v1', () => {
  expect(fase(6)).toMatch(/osmId/);
  for (const l of ['linkPreview', 'linkGpx', 'linkScheda']) expect(INSTRUCTIONS).toContain(l);
  expect(INSTRUCTIONS).toMatch(/INTATTI/);
  expect(INSTRUCTIONS).toMatch(/fuori dall'area/);
  expect(INSTRUCTIONS).toContain('trattiConAltroProfilo');
  expect(INSTRUCTIONS).toContain('suggerimentoProfilo');
  expect(INSTRUCTIONS).toContain('poiMancanti');
  for (const p of ['prudente', 'escursionista', 'esperto', 'alpinista', 'mtb', 'libero']) expect(INSTRUCTIONS).toContain(p);
});

// --- lato negativo: cio' che le istruzioni non devono mai dire ---

it('istruzioni: nessuna frase afferma che il servizio da il meteo o la previsione', () => {
  // l'unica afferma-zione ammessa e' la negazione "non fornisce il meteo"
  expect(INSTRUCTIONS).toMatch(/non fornisce (il )?meteo/i);
  expect(INSTRUCTIONS).not.toMatch(/(?<!non )\b(fornisce|offre|restituisce|include|calcola|ti d[aà]|ti fornisce)(?![a-z])[^.]*\b(meteo|prevision\w*)/i);
  expect(INSTRUCTIONS).not.toMatch(/\b(meteo|prevision\w*)\b[^.]*\b(e'|è) (fornit|inclus|calcolat)/i);
});

it('istruzioni: nessuna frase permette di saltare o aggirare il gate', () => {
  // l'unica menzione del salto del gate e' la negazione "non si salta mai"
  const saltaGate = INSTRUCTIONS.match(/[^.]*\b(salt\w+|ignor\w+|aggir\w+|omett\w+|senza (la )?conferma)[^.]*\./gi) ?? [];
  for (const f of saltaGate.filter(x => /gate|conferma|fase 5/i.test(x))) {
    expect(f, `frase che indebolisce il gate: ${f}`).toMatch(/non si salta mai|senza un si' chiaro non si va avanti/i);
  }
  expect(INSTRUCTIONS).not.toMatch(/(se|quando)[^.]*(fretta|urgen|insiste)[^.]*(salt|ometti|senza|puoi)/i);
  expect(INSTRUCTIONS).not.toMatch(/gate[^.]*(si puo'|puoi|e' possibile)[^.]*(salt|omett|ignor)/i);
});

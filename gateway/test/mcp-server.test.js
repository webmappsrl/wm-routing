import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {makeRouteTool, makeMcpServer} from '../src/mcp/server.js';
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

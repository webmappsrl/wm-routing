import {publicUrlDi} from './mcp/public-url.js';
import {readFileSync} from 'node:fs';
import express from 'express';
import Database from 'better-sqlite3';
import {loadConfig} from './config.js';
import {createApp} from './app.js';
import {createEngine} from './engine.js';
import {makeFallbackRoute, makeRouteCore, makeRouteHandler} from './route.js';
import {makeRejoinHandler} from './rejoin/rejoin.js';
import {makeGRouter} from './mcp/g-route.js';
import {makeResolvePoi} from './mcp/poi.js';
import {makeMcpHttpHandler} from './mcp/http.js';
import {logEvent} from './log.js';

const config = loadConfig(process.env.WM_CONFIG ?? new URL('../config', import.meta.url).pathname);
const dataStamp = () => JSON.parse(readFileSync(process.env.WM_STAMP ?? '/graph/stamp.json', 'utf8'));
// il rettangolo sta solo in tools/bbox.sh: il compose lo passa, qui non c'e' un default
if (!process.env.WM_GRAPH_BBOX) throw new Error('serve WM_GRAPH_BBOX (tools/bbox.sh)');
const BBOX = process.env.WM_GRAPH_BBOX.split(',').map(Number);
const waysDb = new Database(process.env.WM_WAYS_DB ?? '/graph/ways.sqlite', {readonly: true});
const engine = createEngine(process.env.WM_ENGINE_URL ?? 'http://engine:8989');
const deps = {config, engine, waysDb, dataStamp, bbox: BBOX};
const route = makeRouteHandler(deps);
const rejoin = makeRejoinHandler({config, engine, compute: makeRouteCore(deps),
  bands: {minM: 50, maxM: {foot: 1000, mtb: 2000}}, offsetsM: [0, 500, 1000],
  matchLimits: {meanM: 30, maxM: 100}, bbox: BBOX});

const app = createApp({config, dataStamp, area: BBOX, handlers: {route, rejoin}});
app.use('/preview', express.static(process.env.WM_PREVIEW ?? new URL('../../preview', import.meta.url).pathname));
// link firmati dei deliverable MCP: la rotta esiste solo se c'e' la chiave.
// Lo stesso fallback per tratti di /v1: un giro consegnato in chat col
// fallback deve scaricare il suo GPX, non morire con nessun_percorso
if (process.env.WM_LINK_KEY) {
  app.use('/g', makeGRouter({
    publicUrl: publicUrlDi(process.env.WM_PUBLIC_URL, `http://127.0.0.1:${process.env.PORT ?? 8991}`),
    compute: makeFallbackRoute({config, compute: makeRouteCore(deps)}),
    shard: config.shards.mcp, bbox: BBOX, key: process.env.WM_LINK_KEY, dataStamp,
    resolvePoi: makeResolvePoi({waysDbPath: process.env.WM_WAYS_DB ?? '/graph/ways.sqlite'})}));
}
// rotta MCP online: interruttore esplicito, token in query string (mai nei log)
if (process.env.WM_MCP_ENABLED === '1' && process.env.WM_MCP_TOKEN && process.env.WM_LINK_KEY) {
  const port = Number(process.env.PORT ?? 8991);
  app.all('/mcp', makeMcpHttpHandler({
    token: process.env.WM_MCP_TOKEN,
    serverOpts: {
      gatewayUrl: `http://127.0.0.1:${port}`,
      publicUrl: publicUrlDi(process.env.WM_PUBLIC_URL, `http://127.0.0.1:${port}`),
      linkKey: process.env.WM_LINK_KEY,
      waysDbPath: process.env.WM_WAYS_DB ?? '/graph/ways.sqlite',
      log: logEvent,
    },
  }));
}
app.listen(Number(process.env.PORT ?? 8991), '0.0.0.0',
  () => console.log(`gateway in ascolto su ${process.env.PORT ?? 8991}`));

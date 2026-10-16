import {readFileSync} from 'node:fs';
import express from 'express';
import Database from 'better-sqlite3';
import {loadConfig} from './config.js';
import {createApp} from './app.js';
import {createEngine} from './engine.js';
import {makeRouteCore, makeRouteHandler} from './route.js';
import {makeRejoinHandler} from './rejoin/rejoin.js';

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

const app = createApp({config, dataStamp, handlers: {route, rejoin}});
app.use('/preview', express.static(process.env.WM_PREVIEW ?? new URL('../../preview', import.meta.url).pathname));
app.listen(Number(process.env.PORT ?? 8991), '0.0.0.0',
  () => console.log(`gateway in ascolto su ${process.env.PORT ?? 8991}`));

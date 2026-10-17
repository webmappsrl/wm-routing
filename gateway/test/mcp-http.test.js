import {it, expect} from 'vitest';
import express from 'express';
import request from 'supertest';
import {makeMcpHttpHandler} from '../src/mcp/http.js';

const TOKEN = 'token-di-prova';
const app = ({token = TOKEN, log = () => {}, rate} = {}) => {
  const a = express();
  a.use(express.json());
  a.all('/mcp', makeMcpHttpHandler({
    token, log, rate,
    serverOpts: {gatewayUrl: 'http://127.0.0.1:1', publicUrl: 'http://x', linkKey: 'k'},
  }));
  return a;
};
const initBody = {jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 't', version: '0'}}};
const post = (a, body, token) => request(a).post('/mcp' + (token ? `?t=${token}` : ''))
  .set('Accept', 'application/json, text/event-stream').send(body);

it('senza token: 401 asciutto', async () => {
  const r = await post(app(), initBody);
  expect(r.status).toBe(401);
  expect(r.body.stato).toBe('non_autorizzato');
});

it('token sbagliato: 401', async () => {
  expect((await post(app(), initBody, 'altro')).status).toBe(401);
});

it('token giusto: il server MCP risponde all\'handshake', async () => {
  const r = await post(app(), initBody, TOKEN);
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.body)).toContain('wm-routing');
});

it('il log non contiene il token ne\' coordinate', async () => {
  const rows = [];
  const a = app({log: e => rows.push(e)});
  await post(a, initBody, TOKEN);
  await post(a, initBody);
  expect(rows.length).toBeGreaterThan(0);
  const s = JSON.stringify(rows);
  expect(s).not.toContain(TOKEN);
  expect(s).not.toMatch(/\d+\.\d{3,}/);
});

it('oltre il rate limit: 429', async () => {
  const a = app({rate: {capacity: 1, perSecond: 0.001}});
  await post(a, initBody, TOKEN);
  const r = await post(a, initBody, TOKEN);
  expect(r.status).toBe(429);
  expect(r.body.stato).toBe('troppe_richieste');
});

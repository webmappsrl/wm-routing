// Transport streamable HTTP del server MCP: una rotta sola, senza stato
// (un server e un transport per richiesta), dietro un token in query string
// e un rate limit. Il token e la query non finiscono mai nei log.
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {makeMcpServer} from './server.js';
import {createRateLimiter} from '../rate-limit.js';
import {logEvent} from '../log.js';

export function makeMcpHttpHandler({token, serverOpts, rate = {capacity: 60, perSecond: 2}, log = logEvent}) {
  const limiter = createRateLimiter(rate);
  return async (req, res) => {
    const t0 = Date.now();
    const done = () => log({route: '/mcp', status: res.statusCode, ms: Date.now() - t0});
    if (!token || req.query.t !== token) { res.status(401).json({stato: 'non_autorizzato'}); return done(); }
    if (!limiter.take(`mcp|${req.ip}`)) { res.status(429).json({stato: 'troppe_richieste'}); return done(); }
    try {
      const server = makeMcpServer(serverOpts);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, enableJsonResponse: true,
      });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({stato: 'errore'});
    } finally { done(); }
  };
}

import express from 'express';
import {corsHeaders} from './cors.js';
import {createRateLimiter} from './rate-limit.js';
import {logEvent} from './log.js';

export function createApp({config, dataStamp, area, handlers = {}}) {
  const app = express();
  app.disable('x-powered-by');
  // dietro Caddy le richieste arrivano dal proxy: senza fidarsi di lui tutti gli
  // utenti finirebbero nello stesso secchio del limite di richieste. In Docker
  // la connessione entra dal bridge (172.x, indirizzo privato), non da
  // 127.0.0.1; la porta e' pubblicata solo su 127.0.0.1, quindi da fuori
  // nessuno puo' fingersi il proxy.
  app.set('trust proxy', ['loopback', 'uniquelocal']);
  app.use(express.json({limit: '2mb'}));
  const limiters = Object.fromEntries(
    Object.entries(config.shards).map(([id, s]) => [id, createRateLimiter(s.rate)]));

  app.get('/v1/version', (_req, res) => {
    res.set('Cache-Control', 'no-cache').json(area ? {...dataStamp(), area} : dataStamp());
  });

  app.use('/v1/:shard', (req, res, next) => {
    const t0 = Date.now();
    const shard = config.shards[req.params.shard];
    if (!shard) return res.status(404).json({stato: 'shard_sconosciuto'});
    const cors = corsHeaders(shard, req.get('Origin'));
    if (cors) res.set(cors);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!limiters[req.params.shard].take(`${req.params.shard}|${req.ip}`))
      return res.status(429).json({stato: 'troppe_richieste'});
    res.on('finish', () => logEvent({
      route: `/v1/:shard${req.path}`, status: res.statusCode, ms: Date.now() - t0,
      shard: req.params.shard, profile: typeof req.body?.profile === 'string' ? req.body.profile : undefined,
    }));
    req.shard = shard;
    next();
  });

  app.get('/v1/:shard/profiles', (req, res) => {
    res.json(Object.entries(req.shard.profiles).map(([name, engineName]) => ({
      name, mode: config.profiles[engineName].mode, version: config.profiles[engineName].version,
    })));
  });

  if (handlers.route) app.post('/v1/:shard/route', handlers.route);
  if (handlers.rejoin) app.post('/v1/:shard/rejoin', handlers.rejoin);
  return app;
}

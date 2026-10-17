#!/usr/bin/env node
// Avvio stdio del server MCP: lo lanciano Claude Desktop/Claude Code.
// La chiave dei link viene dall'ambiente o dallo .env nella radice del repo.
import {readFileSync} from 'node:fs';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {makeMcpServer} from './server.js';

function fromDotenv(name) {
  try {
    return readFileSync(new URL('../../../.env', import.meta.url), 'utf8')
      .match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1];
  } catch { return undefined; }
}

const linkKey = process.env.WM_LINK_KEY ?? fromDotenv('WM_LINK_KEY');
if (!linkKey) {
  console.error('serve WM_LINK_KEY: nell\'ambiente o nello .env della radice del repo');
  process.exit(1);
}
const gatewayUrl = process.env.WM_GATEWAY_URL ?? 'http://127.0.0.1:8991';
await makeMcpServer({
  gatewayUrl,
  publicUrl: process.env.WM_PUBLIC_URL ?? gatewayUrl,
  linkKey,
  waysDbPath: process.env.WM_WAYS_DB ?? new URL('../../../data/ways.sqlite', import.meta.url).pathname,
}).connect(new StdioServerTransport());

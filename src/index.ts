import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { logger } from 'hono/logger';

console.log(`
\x1b[1;37m  ███████╗██╗  ██╗██╗   ██╗███╗   ██╗██╗   ██╗██╗
  ██╔════╝██║ ██╔╝╚██╗ ██╔╝████╗  ██║██║   ██║██║
  ███████╗█████╔╝  ╚████╔╝ ██╔██╗ ██║██║   ██║██║
  ╚════██║██╔═██╗   ╚██╔╝  ██║╚██╗██║██║   ██║██║
  ███████║██║  ██╗   ██║   ██║ ╚████║╚██████╔╝███████╗
  ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝\x1b[0m
\x1b[90m backend · v0.0.1 · node ${process.versions.node}\x1b[0m
`);

import { authMiddleware } from './middleware/auth';
import { corsMiddleware } from './middleware/cors';
import { agentGroup } from './routes/agent';
import { aiGroup } from './routes/ai';
import { coinbaseAuthGroup } from './routes/auth/coinbase';
import { plaidAuthGroup } from './routes/auth/plaid';
import { prometeoAuthGroup } from './routes/auth/prometeo';
import { walletAuthGroup } from './routes/auth/wallet';
import { channelManager, integrationsGroup } from './routes/integrations';
import { systemGroup } from './routes/system';
import { tasksGroup } from './routes/tasks';
import { walletGroup } from './routes/wallet';
import { addClient, clientCount, removeClient } from './ws/events';

const app = new Hono();

app.onError((err, c) => {
  console.error('[server] Unhandled error:', err);
  return c.json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message }, 500);
});

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Capture the chained result so `typeof routes` carries full route type info
// (typeof app alone is the base Hono<{},{},"/">  — no route signatures).
const routes = app
  .use(logger())
  .use(corsMiddleware)
  .use(authMiddleware)

  // ── Health ──────────────────────────────────────────────────────────────────
  .get('/ping', (c) => c.json({ status: 'ok', ts: Date.now(), wsClients: clientCount() }))

  // ── WebSocket ───────────────────────────────────────────────────────────────
  .get(
    '/ws',
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        addClient(ws);
        ws.send(JSON.stringify({ type: 'connected', payload: { ts: Date.now() } }));
      },
      onClose(_event, ws) {
        removeClient(ws);
      },
      onError(_event, ws) {
        removeClient(ws);
      },
    }))
  )

  // ── Routes ──────────────────────────────────────────────────────────────────
  .route('/api/tasks', tasksGroup)
  .route('/api/ai', aiGroup)
  .route('/api/agent', agentGroup)
  .route('/api/integrations', integrationsGroup)
  .route('/api/system', systemGroup)
  .route('/api/wallet', walletGroup)
  .route('/auth/coinbase', coinbaseAuthGroup)
  .route('/auth/prometeo', prometeoAuthGroup)
  .route('/auth/plaid', plaidAuthGroup)
  .route('/auth/wallet', walletAuthGroup);

// ── Export type for hono/client (hc) ────────────────────────────────────────
export type AppType = typeof routes;

// ── Start server ────────────────────────────────────────────────────────────
const port = Number.parseInt(process.env.SKYNUL_PORT ?? '3141', 10);

async function start() {
  for (let i = 0; i < 10; i++) {
    const p = port + i;
    try {
      const server = serve({ fetch: routes.fetch, port: p, hostname: '0.0.0.0' }, (info) => {
        console.log(`\x1b[36m▸\x1b[0m listening on \x1b[1;32mhttp://0.0.0.0:${info.port}\x1b[0m`);
      });
      injectWebSocket(server);
      return;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('EADDRINUSE')) {
        if (i === 9) throw err;
        continue;
      }
      throw err;
    }
  }
}

start();

// ── Graceful shutdown ──────────────────────────────────────────────────────
const shutdown = async () => {
  console.log('\nShutting down...');
  await channelManager.stopAll();
  const { taskManager } = await import('./routes/tasks');
  taskManager.destroyAll();
  const { closeSharedPlaywrightChromeCdp } = await import('./core/browser/playwright-cdp');
  await closeSharedPlaywrightChromeCdp();
  const { closeProjectDb } = await import('./core/stores/project-store');
  closeProjectDb();
  const { closeMemoryDb } = await import('./core/agent/task-memory');
  closeMemoryDb();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

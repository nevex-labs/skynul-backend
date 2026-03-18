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
import { browser } from './routes/browser';
import { channelManager, channels } from './routes/channels';
import { chat } from './routes/chat';
import { chatgpt } from './routes/chatgpt';
import { dialogs } from './routes/dialogs';
import { ollama } from './routes/ollama';
import { policy } from './routes/policy';
import { projects } from './routes/projects';
import { runtime } from './routes/runtime';
import { schedules } from './routes/schedules';
import { secrets } from './routes/secrets';
import { skills } from './routes/skills';
import { tasks } from './routes/tasks';
import { addClient, clientCount, removeClient } from './ws/events';

const app = new Hono();

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
  .route('/api/tasks', tasks)
  .route('/api/policy', policy)
  .route('/api/channels', channels)
  .route('/api/skills', skills)
  .route('/api/schedules', schedules)
  .route('/api/chat', chat)
  .route('/api/projects', projects)
  .route('/api/secrets', secrets)
  .route('/api/browser', browser)
  .route('/api/ollama', ollama)
  .route('/api/chatgpt', chatgpt)
  .route('/api/runtime', runtime)
  .route('/api/dialogs', dialogs);

// ── Export type for hono/client (hc) ────────────────────────────────────────
export type AppType = typeof routes;

// ── Start server ────────────────────────────────────────────────────────────
const port = Number.parseInt(process.env.SKYNUL_PORT ?? '3141', 10);

async function start() {
  for (let i = 0; i < 10; i++) {
    const p = port + i;
    try {
      const server = serve({ fetch: routes.fetch, port: p }, (info) => {
        console.log(`\x1b[36m▸\x1b[0m listening on \x1b[1;32mhttp://localhost:${info.port}\x1b[0m`);
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
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import channelsRouter from './api/channels/router';
import skillsRouter from './api/skills/router';
import tasksRouter from './api/tasks/router';
import authRouter from './auth/router';
import { config } from './core/config';

import { authMiddleware } from './middleware/auth';
import { corsMiddleware } from './middleware/cors';
import { addClient, removeClient } from './ws/events';

const app = new Hono();

app.onError((err, c) => {
  console.error('[server] Unhandled error:', err);
  return c.json({ error: config.nodeEnv === 'production' ? 'Internal server error' : err.message }, 500);
});

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const routes = app
  .use(logger())
  .use(corsMiddleware)
  .use(authMiddleware)
  .route('/auth', authRouter)
  .route('/api/tasks', tasksRouter)
  .route('/api/skills', skillsRouter)
  .route('/api/channels', channelsRouter)
  .get(
    '/ws',
    upgradeWebSocket(() => ({
      onOpen(_evt, ws) {
        addClient(ws);
      },
      onClose(_evt, ws) {
        removeClient(ws);
      },
    }))
  )
  .get('/ping', (c) => c.text('pong'));

export type AppType = typeof routes;

const port = config.port;

async function start() {
  for (let i = 0; i < 10; i++) {
    const p = port + i;
    try {
      const server = serve({ fetch: routes.fetch, port: p, hostname: '0.0.0.0' }, (info) => {
        console.log(`\x1b[36m▸\x1b[0m listening on \x1b[1;32mhttp://0.0.0.0:${info.port}\x1b[0m`);
      });
      injectWebSocket(server);
      console.log(`\x1b[32m✓\x1b[0m Server ready`);
      break;
    } catch {
      // Port taken, try next
    }
  }
}

start();

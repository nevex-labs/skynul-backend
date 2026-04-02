import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { config } from './core/config';
import { logger } from './core/logger';
import { isServerShuttingDown, markServerStarted, setupShutdownHandlers } from './core/shutdown';
import { authMiddleware } from './middleware/auth';
import { checkWebSocketRateLimit, globalRateLimiter } from './middleware/rate-limit';
import { requestLogger } from './middleware/request-logger';
import { agentGroup } from './routes/agent';
import { aiGroup } from './routes/ai';
import { coinbaseAuthGroup } from './routes/auth/coinbase';
import { walletAuthGroup } from './routes/auth/wallet';
import { channelManager, integrationsGroup } from './routes/integrations';
import { systemGroup } from './routes/system';
import { tasksGroup } from './routes/tasks';
import { walletGroup } from './routes/wallet';
import { addClient, clientCount, removeClient } from './ws/events';

// ASCII Art Banner
console.log(`
\x1b[1;37m  ███████╗██╗  ██╗██╗   ██╗███╗   ██╗██╗   ██╗██╗
  ██╔════╝██║ ██╔╝╚██╗ ██╔╝████╗  ██║██║   ██║██║
  ███████╗█████╔╝  ╚████╔╝ ██╔██╗ ██║██║   ██║██║
  ╚════██║██╔═██╗   ╚██╔╝  ██║╚██╗██║██║   ██║██║
  ███████║██║  ██╗   ██║   ██║ ╚████║╚██████╔╝███████╗
  ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝\x1b[0m
\x1b[90m backend · v0.0.1 · node ${process.versions.node} · ${config.nodeEnv}\x1b[0m
`);

const app = new Hono();

// Error handler
app.onError((err, c) => {
  logger.error({ err }, 'Unhandled error');
  return c.json(
    {
      error: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
    },
    500
  );
});

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Build routes
const routes = app
  .use(requestLogger)
  .use(globalRateLimiter)
  .use(authMiddleware)

  // Health
  .get('/ping', (c) =>
    c.json({
      status: 'ok',
      ts: Date.now(),
      wsClients: clientCount(),
      shuttingDown: isServerShuttingDown(),
    })
  )
  .get('/health', (c) => {
    if (isServerShuttingDown()) {
      return c.json({ status: 'shutting_down' }, 503);
    }
    return c.json({ status: 'ok', timestamp: Date.now() });
  })

  // WebSocket
  .get(
    '/ws',
    (c, next) => {
      const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
      const result = checkWebSocketRateLimit(ip);

      for (const [key, value] of Object.entries(result.headers)) {
        c.header(key, value);
      }

      if (!result.allowed) {
        return c.json({ error: 'Rate limit exceeded' }, 429);
      }

      return next();
    },
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

  // API Routes
  .route('/api/tasks', tasksGroup)
  .route('/api/ai', aiGroup)
  .route('/api/agent', agentGroup)
  .route('/api/integrations', integrationsGroup)
  .route('/api/system', systemGroup)
  .route('/api/wallet', walletGroup)
  .route('/auth/coinbase', coinbaseAuthGroup)
  .route('/auth/wallet', walletAuthGroup);

export type AppType = typeof routes;

// Start server
async function start() {
  for (let i = 0; i < 10; i++) {
    const p = config.port + i;
    try {
      const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
        const srv = serve({ fetch: routes.fetch, port: p, hostname: '0.0.0.0' }, (info) => {
          console.log(`\x1b[36m▸\x1b[0m listening on \x1b[1;32mhttp://0.0.0.0:${info.port}\x1b[0m`);
          resolve(srv);
        });
        srv.on('error', reject);
        injectWebSocket(srv);
      });

      markServerStarted();
      setupShutdownHandlers(server);
      return server;
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'EADDRINUSE') {
        if (i === 9) throw err;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to start server on any port');
}

await start();

import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';

console.log(`
\x1b[1;37m  ███████╗██╗  ██╗██╗   ██╗███╗   ██╗██╗   ██╗██╗
  ██╔════╝██║ ██╔╝╚██╗ ██╔╝████╗  ██║██║   ██║██║
  ███████╗█████╔╝  ╚████╔╝ ██╔██╗ ██║██║   ██║██║
  ╚════██║██╔═██╗   ╚██╔╝  ██║╚██╗██║██║   ██║██║
  ███████║██║  ██╗   ██║   ██║ ╚████║╚██████╔╝███████╗
  ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝\x1b[0m
\x1b[90m backend · v0.0.1 · node ${process.versions.node}\x1b[0m
`);

import { logger } from './core/logger';
import { authMiddleware } from './middleware/auth';
import { corsMiddleware } from './middleware/cors';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { checkWebSocketRateLimit } from './middleware/rate-limit';
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

const app = new Hono();

app.onError((err, c) => {
  logger.error({ err }, 'Unhandled error');
  return c.json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message }, 500);
});

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Capture the chained result so `typeof routes` carries full route type info
// (typeof app alone is the base Hono<{},{},"/">  — no route signatures).
const routes = app
  .use(requestLogger)
  .use(corsMiddleware)
  .use(rateLimitMiddleware)
  .use(authMiddleware)

  // ── Health ──────────────────────────────────────────────────────────────────
  .get('/ping', (c) => c.json({ status: 'ok', ts: Date.now(), wsClients: clientCount() }))

  // ── WebSocket ───────────────────────────────────────────────────────────────
  .get(
    '/ws',
    (c, next) => {
      // Rate limit check before upgrade
      const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
      const rateLimitResult = checkWebSocketRateLimit(ip);

      // Apply rate limit headers regardless
      for (const [key, value] of Object.entries(rateLimitResult.headers)) {
        c.header(key, value);
      }

      if (!rateLimitResult.allowed) {
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

  // ── Routes ──────────────────────────────────────────────────────────────────
  .route('/api/tasks', tasksGroup)
  .route('/api/ai', aiGroup)
  .route('/api/agent', agentGroup)
  .route('/api/integrations', integrationsGroup)
  .route('/api/system', systemGroup)
  .route('/api/wallet', walletGroup)
  .route('/auth/coinbase', coinbaseAuthGroup)
  .route('/auth/wallet', walletAuthGroup);

// ── Export type for hono/client (hc) ────────────────────────────────────────
export type AppType = typeof routes;

// ── Start server ────────────────────────────────────────────────────────────
const port = Number.parseInt(process.env.SKYNUL_PORT ?? '3141', 10);

async function start(): Promise<ReturnType<typeof serve>> {
  for (let i = 0; i < 10; i++) {
    const p = port + i;
    try {
      const server = serve({ fetch: routes.fetch, port: p, hostname: '0.0.0.0' }, (info) => {
        console.log(`\x1b[36m▸\x1b[0m listening on \x1b[1;32mhttp://0.0.0.0:${info.port}\x1b[0m`);
      });
      injectWebSocket(server);
      return server;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('EADDRINUSE')) {
        if (i === 9) throw err;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to start server on any port');
}

// ── Graceful shutdown ──────────────────────────────────────────────────────
let isShuttingDown = false;
let serverStarted = false;
const SHUTDOWN_TIMEOUT = Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '30000', 10);

let server: ReturnType<typeof serve> | undefined;
try {
  server = await start();
  serverStarted = true;
} catch (error) {
  logger.error({ error }, 'Failed to start server');
  process.exit(1);
}

const shutdown = async (signal: string) => {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, forcing exit...');
    process.exit(1);
  }

  // If server never started, just exit without cleanup
  if (!serverStarted) {
    logger.warn({ signal }, 'Server never started, exiting without cleanup');
    process.exit(1);
  }

  isShuttingDown = true;
  logger.info({ signal }, 'Starting graceful shutdown...');

  // Create a timeout promise
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('Shutdown timeout')), SHUTDOWN_TIMEOUT);
  });

  try {
    // Race between graceful shutdown and timeout
    await Promise.race([gracefulShutdown(), timeoutPromise]);

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Graceful shutdown failed or timed out, forcing exit');
    process.exit(1);
  }
};

async function gracefulShutdown() {
  // 1. Stop accepting new connections
  if (server) {
    logger.info('Closing HTTP server...');
    server.close();
  }

  // 2. Close WebSocket connections
  logger.info('Closing WebSocket connections...');
  const { closeAllClients } = await import('./ws/events');
  closeAllClients();

  // 3. Stop all channel integrations
  logger.info('Stopping channel integrations...');
  await channelManager.stopAll();

  // 4. Mark running tasks as shutting_down and wait for them
  const { taskManager } = await import('./routes/tasks');
  const activeTaskCount = taskManager.markShuttingDown();
  logger.info({ activeTaskCount }, 'Marked tasks as shutting_down, waiting for completion...');

  if (activeTaskCount > 0) {
    // Wait up to 60 seconds for tasks to complete gracefully
    const AGENT_LOOP_TIMEOUT = 60000;
    const allCompleted = await taskManager.waitForAllTasks(AGENT_LOOP_TIMEOUT);
    if (allCompleted) {
      logger.info('All tasks completed gracefully');
    } else {
      logger.warn('Timeout waiting for tasks, forcing cancellation');
    }
  }

  // 5. Kill background processes from ProcessRegistry
  logger.info('Killing background processes...');
  const { getProcessRegistry } = await import('./core/agent/process-registry');
  const processRegistry = getProcessRegistry();
  processRegistry.destroyAll();

  // 6. Destroy remaining tasks
  logger.info('Destroying remaining tasks...');
  taskManager.destroyAll();

  // 7. Close browser connections
  logger.info('Closing browser connections...');
  const { closeSharedPlaywrightChromeCdp } = await import('./core/browser/playwright-cdp');
  await closeSharedPlaywrightChromeCdp();

  // 8. Close database connections
  logger.info('Closing database connections...');
  const { closeProjectDb } = await import('./core/stores/project-store');
  closeProjectDb();
  const { closeMemoryDb } = await import('./core/agent/task-memory');
  closeMemoryDb();

  // 9. Flush logs
  logger.info('Flushing logs...');
  await logger.flush();
}

// Health check endpoint that returns 503 during shutdown
app.get('/health', (c) => {
  if (isShuttingDown) {
    return c.json({ status: 'shutting_down' }, 503);
  }
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// Handle signals
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGUSR2', () => {
  // SIGUSR2 is used by nodemon for restart
  logger.info('SIGUSR2 received (nodemon restart), shutting down gracefully...');
  void shutdown('SIGUSR2');
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception');
  void shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});

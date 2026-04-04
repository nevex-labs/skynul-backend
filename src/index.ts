import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Hono } from 'hono';
import { config } from './core/config';
import { logger } from './core/logger';
import { isServerShuttingDown, markServerStarted, setupShutdownHandlers } from './core/shutdown';
import * as schema from './infrastructure/db/schema';
import { authMiddleware } from './middleware/auth';
import { jwtMiddleware } from './middleware/jwt';
import { checkWebSocketRateLimit, globalRateLimiter } from './middleware/rate-limit';
import { requestLogger } from './middleware/request-logger';
import { agentGroup } from './routes/agent';
import { aiGroup } from './routes/ai';
import { analytics } from './routes/analytics';
import { coinbaseAuthGroup } from './routes/auth/coinbase';
import { walletAuthGroup } from './routes/auth/wallet';
import { channelManager, integrationsGroup } from './routes/integrations';
import { providersGroup } from './routes/providers';
import { systemGroup } from './routes/system';
import { schedules, tasksGroup } from './routes/tasks';
import { tradingProvidersGroup } from './routes/trading-providers';
import { walletGroup } from './routes/wallet';
import { getPool } from './services/database/layer';
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
  .use(jwtMiddleware)

  // Health
  .get('/ping', (c) =>
    c.json({
      status: 'ok',
      ts: Date.now(),
      wsClients: clientCount(),
      shuttingDown: isServerShuttingDown(),
    })
  )
  .get('/health', async (c) => {
    if (isServerShuttingDown()) {
      return c.json({ status: 'shutting_down' }, 503);
    }

    // Check database connectivity
    const pool = getPool();
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      return c.json({ status: 'degraded', database: 'unreachable' }, 503);
    }

    return c.json({ status: 'ok', timestamp: Date.now() });
  })

  // Fly.io metrics endpoint (Prometheus format)
  .get('/metrics', async (c) => {
    const { taskManager } = await import('./routes/tasks');
    const { getProcessRegistry } = await import('./core/agent/process-registry');
    const registry = getProcessRegistry();
    const activeTasks = taskManager.list().filter((t) => t.status === 'running').length;
    const stats = registry.getStats();

    const metrics = [
      '# HELP app_active_tasks Number of currently running tasks',
      '# TYPE app_active_tasks gauge',
      `app_active_tasks ${activeTasks}`,
      '# HELP app_ws_clients Number of connected WebSocket clients',
      '# TYPE app_ws_clients gauge',
      `app_ws_clients ${clientCount()}`,
      '# HELP app_process_count Number of background processes',
      '# TYPE app_process_count gauge',
      `app_process_count ${stats.running}`,
    ].join('\n');

    c.header('Content-Type', 'text/plain');
    return c.text(metrics);
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
  .route('/api/schedules', schedules)
  .route('/api/ai', aiGroup)
  .route('/api/agent', agentGroup)
  .route('/api/integrations', integrationsGroup)
  .route('/api/providers', providersGroup)
  .route('/api/trading-providers', tradingProvidersGroup)
  .route('/api/system', systemGroup)
  .route('/api/wallet', walletGroup)
  .route('/api/analytics', analytics)
  .route('/auth/coinbase', coinbaseAuthGroup)
  .route('/auth/wallet', walletAuthGroup);

export type AppType = typeof routes;

// Start server
async function start() {
  // Apply pending migrations (production) or sync schema (development)
  try {
    const pool = getPool();
    const db = drizzle(pool, { schema });

    if (config.nodeEnv === 'production') {
      console.log('🔄 Applying database migrations...');
      await migrate(db, { migrationsFolder: './src/infrastructure/db/migrations' });
      console.log('✓ Database migrations up to date');
    } else {
      console.log('✓ Database connected (dev mode — ejecutá `pnpm db:migrate` si hay migraciones nuevas)');
    }

    // Ensure system user exists (for TaskManager and system-level operations)
    await db.execute(`INSERT INTO users (id, email) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING`);
  } catch (err) {
    console.error('⚠️  Database migration failed — server will start but DB features may not work');
    console.error(`   Error: ${err instanceof Error ? err.message : String(err)}`);
  }

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

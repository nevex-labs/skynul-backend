import { serve } from '@hono/node-server';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Hono } from 'hono';
import { join } from 'node:path';
import * as schema from './db/schema';
import { config } from './core/config';
import { logger } from './core/logger';
import { isServerShuttingDown, markServerStarted, setupShutdownHandlers } from './core/shutdown';
import { authMiddleware } from './middleware/auth';
import { jwtMiddleware } from './middleware/jwt';
import { globalRateLimiter } from './middleware/rate-limit';
import { requestLogger } from './middleware/request-logger';
import { taskManager, tasksRoutes } from './routes/tasks';
import { getDbPool } from './v2/secret-reader';

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

app.onError((err, c) => {
  logger.error({ err }, 'Unhandled error');
  return c.json(
    {
      error: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
    },
    500
  );
});

const routes = app
  .use(requestLogger)
  .use(globalRateLimiter)
  .use(authMiddleware)
  .use(jwtMiddleware)
  .get('/ping', (c) =>
    c.json({
      status: 'ok',
      ts: Date.now(),
      shuttingDown: isServerShuttingDown(),
    })
  )
  .get('/health', async (c) => {
    if (isServerShuttingDown()) {
      return c.json({ status: 'shutting_down' }, 503);
    }
    const pool = getDbPool();
    try {
      await pool.query('SELECT 1');
    } catch {
      return c.json({ status: 'degraded', database: 'unreachable' }, 503);
    }
    return c.json({ status: 'ok', timestamp: Date.now() });
  })
  .get('/metrics', async (c) => {
    const activeTasks = taskManager.list().filter((t) => t.status === 'running').length;
    const metrics = [
      '# HELP app_active_tasks Number of currently running tasks',
      '# TYPE app_active_tasks gauge',
      `app_active_tasks ${activeTasks}`,
    ].join('\n');
    c.header('Content-Type', 'text/plain');
    return c.text(metrics);
  })
  .route('/api/tasks', tasksRoutes);

export type AppType = typeof routes;

async function start() {
  try {
    const pool = getDbPool();
    const db = drizzle(pool, { schema });

    if (config.nodeEnv === 'production') {
      console.log('🔄 Applying database migrations...');
      const migrationsFolder =
        process.env.MIGRATIONS_FOLDER ?? join(process.cwd(), 'src/infrastructure/db/migrations');
      await migrate(db, { migrationsFolder });
      console.log('✓ Database migrations up to date');
    } else {
      console.log('✓ Database connected (dev mode — ejecutá `pnpm db:migrate` si hay migraciones nuevas)');
    }

    await db.execute(sql`INSERT INTO users (id, email) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING`);
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

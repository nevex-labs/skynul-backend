import { drizzle } from 'drizzle-orm/node-postgres';
import { Config, Effect, Layer } from 'effect';
import { Pool } from 'pg';
import * as schema from '../../infrastructure/db/schema';
import { DatabaseService } from './tag';

// ── Singleton pool compartido ─────────────────────────────────────────────
// El pool se crea una sola vez y se reusa en todo el lifecycle de la app.
// Esto evita que cada request cree/destruya conexiones a PostgreSQL.

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_SIZE) || 20,
    });
    _pool.on('error', (err) => {
      console.error('[db-pool] Unexpected pool error:', err);
    });
  }
  return _pool;
}

export async function closeDatabasePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    console.log('✓ Database pool closed');
  }
}

// ── Layer ─────────────────────────────────────────────────────────────────

const DatabaseConfigLive = Config.all({
  url: Config.string('DATABASE_URL'),
  poolSize: Config.number('DB_POOL_SIZE').pipe(Config.withDefault(20)),
});

export const DatabaseLive = Layer.scoped(
  DatabaseService,
  Effect.gen(function* () {
    // Leer config (para validar que existe DATABASE_URL)
    yield* DatabaseConfigLive;

    // Usar el pool singleton — no crear uno nuevo
    const pool = getPool();
    const db = drizzle(pool, { schema });

    yield* Effect.sync(() => console.log('✓ Database connected'));

    // El cleanup NO cierra el pool — lo cierra closeDatabasePool() en shutdown
    yield* Effect.acquireRelease(Effect.succeed(db), () => Effect.void);

    return db;
  })
);

// Layer para testing
export const DatabaseTest = Layer.succeed(DatabaseService, {} as any);

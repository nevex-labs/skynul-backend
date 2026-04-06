/**
 * Secret Reader — PostgreSQL `secrets` table
 *
 * Simple, direct PostgreSQL reader for the agent stack.
 * No Effect, no namespaces, no encryption layers.
 *
 * Single source of truth: the `secrets` table.
 */

import { Pool } from 'pg';

export type SecretReader = (key: string, userId?: number) => Promise<string | null>;

let pool: Pool | null = null;

export function getDbPool(): Pool {
  return getPool();
}

export async function closeSecretReaderPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number.parseInt(process.env.DB_PORT || '5433'),
      user: process.env.DB_USER || 'skynul',
      password: process.env.DB_PASSWORD || 'skynul_password',
      database: process.env.DB_NAME || 'skynul',
    });
  }
  return pool;
}

/**
 * Read a secret value from the database.
 *
 * @param key - The secret key name (e.g., 'gemini.apiKey')
 * @param userId - The user ID. If not provided, tries all users.
 * @returns The secret value, or null if not found.
 */
export async function readSecret(key: string, userId?: number): Promise<string | null> {
  const db = getPool();

  // Try specific user first
  if (userId != null && userId > 0) {
    const result = await db.query('SELECT encrypted_value FROM secrets WHERE user_id = $1 AND key_name = $2 LIMIT 1', [
      userId,
      key,
    ]);
    if (result.rows.length > 0) {
      return result.rows[0].encrypted_value;
    }
  }

  // Fallback: try any user (global key)
  const result = await db.query('SELECT encrypted_value FROM secrets WHERE key_name = $1 LIMIT 1', [key]);

  return result.rows.length > 0 ? result.rows[0].encrypted_value : null;
}

/**
 * Check if a secret exists.
 */
export async function hasSecret(key: string, userId?: number): Promise<boolean> {
  const val = await readSecret(key, userId);
  return val != null && val.length > 0;
}

/**
 * List all secret keys for a user.
 */
export async function listSecretKeys(userId?: number): Promise<string[]> {
  const db = getPool();

  const query =
    userId != null && userId > 0
      ? 'SELECT DISTINCT key_name FROM secrets WHERE user_id = $1'
      : 'SELECT DISTINCT key_name FROM secrets';

  const params = userId != null && userId > 0 ? [userId] : [];
  const result = await db.query(query, params);

  return result.rows.map((r) => r.key_name);
}

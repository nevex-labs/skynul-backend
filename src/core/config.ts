import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Resolve the data directory for persistent storage.
 *
 * Priority:
 *   1. SKYNUL_DATA_DIR env var (explicit override)
 *   2. ~/.skynul (default for standalone server)
 *
 * In Electron context, the desktop shell passes SKYNUL_DATA_DIR=app.getPath('userData')
 * so both environments share the same data files.
 */
export function getDataDir(): string {
  const dir = process.env.SKYNUL_DATA_DIR ?? join(homedir(), '.skynul');
  mkdirSync(dir, { recursive: true });
  return dir;
}

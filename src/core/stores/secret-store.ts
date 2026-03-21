import { dirname, join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { getDataDir } from '../config';
import { SecretStoreSchema } from './schemas';

type SecretStoreShape = Record<string, string>;

function storePath(): string {
  return join(getDataDir(), 'secrets.json');
}

async function loadRaw(): Promise<SecretStoreShape> {
  try {
    const raw = await readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw);
    const result = SecretStoreSchema.safeParse(parsed);
    if (result.success) return result.data;
    console.warn('[secret-store] Invalid data:', result.error.issues);
    if (parsed && typeof parsed === 'object') return parsed as SecretStoreShape;
    return {};
  } catch {
    return {};
  }
}

async function saveRaw(data: SecretStoreShape): Promise<void> {
  const file = storePath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Server-side secret store.
 *
 * Uses base64 encoding (prefix "p:") for compatibility with the existing
 * Electron secret format. Values written by Electron's safeStorage (prefix
 * "e:") can only be decrypted in the Electron context — when running as a
 * standalone server, those values will return null until re-set.
 *
 * TODO: For production web deployments, integrate a proper vault or KMS.
 */

export async function setSecret(key: string, value: string): Promise<void> {
  const raw = await loadRaw();
  raw[key] = 'p:' + Buffer.from(value, 'utf8').toString('base64');
  await saveRaw(raw);
}

export async function hasSecret(key: string): Promise<boolean> {
  const raw = await loadRaw();
  const v = raw[key];
  if (typeof v !== 'string' || v.length === 0) return false;
  if (v === 'p:') return false;
  return true;
}

export async function getSecret(key: string): Promise<string | null> {
  const raw = await loadRaw();
  const v = raw[key];
  if (!v) return null;
  try {
    if (v.startsWith('p:')) {
      const b64 = v.slice(2);
      if (!b64) return null;
      return Buffer.from(b64, 'base64').toString('utf8');
    }
    // 'e:' prefix = encrypted with Electron's safeStorage, can't decrypt here
    return null;
  } catch {
    return null;
  }
}

export async function getSecretKeys(): Promise<string[]> {
  const raw = await loadRaw();
  return Object.keys(raw);
}

export async function deleteSecret(key: string): Promise<void> {
  const raw = await loadRaw();
  delete raw[key];
  await saveRaw(raw);
}

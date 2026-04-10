import {
  getSecretKeys as dbGetSecretKeys,
  hasSecret as dbHasSecret,
  setSecret as dbSetSecret,
  deleteSecretByUserTypeProvider,
  getSecretByTypeProvider,
  parseLegacySecretKey,
} from '../db/queries/secrets';
import { getSystemUserId } from '../db/queries/users';

export { parseLegacySecretKey };

export async function getSecret(key: string, userId?: string) {
  const uid = userId ?? (await getSystemUserId());
  const { provider, type } = parseLegacySecretKey(key);
  const row = await getSecretByTypeProvider(uid, type, provider);
  return row?.value ?? null;
}

export async function setSecret(key: string, value: string, userId?: string) {
  const uid = userId ?? (await getSystemUserId());
  const { provider, type } = parseLegacySecretKey(key);
  await dbSetSecret(uid, type, provider, value);
}

export async function hasSecret(key: string, userId?: string) {
  const uid = userId ?? (await getSystemUserId());
  const { provider, type } = parseLegacySecretKey(key);
  return dbHasSecret(uid, type, provider);
}

export async function getSecretKeys(userId?: string) {
  const uid = userId ?? (await getSystemUserId());
  return dbGetSecretKeys(uid);
}

export async function deleteSecret(key: string, userId?: string) {
  const uid = userId ?? (await getSystemUserId());
  const { provider, type } = parseLegacySecretKey(key);
  await deleteSecretByUserTypeProvider(uid, type, provider);
}

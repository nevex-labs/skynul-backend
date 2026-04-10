import { and, eq } from 'drizzle-orm';
import { db } from '../index';
import type { NewSecret, Secret } from '../schema/secrets';
import { secretsTable } from '../schema/secrets';
import { getSystemUserId } from './users';

export type { Secret };

const AUTH_SESSION_TYPE = 'auth_session';

export type AuthSession = {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  displayName?: string;
  avatarUrl?: string;
};

export function parseLegacySecretKey(key: string) {
  const i = key.indexOf('.');
  if (i === -1) {
    return { provider: '_', type: key };
  }
  return { provider: key.slice(0, i), type: key.slice(i + 1) };
}

export async function saveAuthSession(session: AuthSession): Promise<void> {
  const uid = await getSystemUserId();
  await setSecret(uid, AUTH_SESSION_TYPE, session.sessionId, JSON.stringify(session));
}

export async function getAuthSession(sessionId: string): Promise<AuthSession | undefined> {
  const uid = await getSystemUserId();
  const row = await getSecretByTypeProvider(uid, AUTH_SESSION_TYPE, sessionId);
  if (!row?.value?.trim()) return undefined;
  try {
    const s = JSON.parse(row.value) as AuthSession;
    if (Date.now() > s.expiresAt) {
      await deleteSecretByUserTypeProvider(uid, AUTH_SESSION_TYPE, sessionId);
      return undefined;
    }
    return s;
  } catch {
    return undefined;
  }
}

export async function removeAuthSession(sessionId: string): Promise<void> {
  const uid = await getSystemUserId();
  await deleteSecretByUserTypeProvider(uid, AUTH_SESSION_TYPE, sessionId);
}

export async function createSecret(input: NewSecret) {
  const [row] = await db.insert(secretsTable).values(input).returning();
  return row;
}

export async function getSecretByTypeProvider(userId: string, type: string, provider: string) {
  const [row] = await db
    .select()
    .from(secretsTable)
    .where(and(eq(secretsTable.userId, userId), eq(secretsTable.type, type), eq(secretsTable.provider, provider)));
  return row ?? null;
}

export async function getSecretsByUser(userId: string) {
  return db.select().from(secretsTable).where(eq(secretsTable.userId, userId));
}

export async function getSecretKeys(userId: string) {
  const rows = await db
    .select({ type: secretsTable.type, provider: secretsTable.provider })
    .from(secretsTable)
    .where(eq(secretsTable.userId, userId));
  return rows.map((r) => `${r.provider}.${r.type}`);
}

export async function hasSecret(userId: string, type: string, provider: string) {
  const row = await getSecretByTypeProvider(userId, type, provider);
  return row !== null;
}

export async function setSecret(userId: string, type: string, provider: string, value: string) {
  const existing = await getSecretByTypeProvider(userId, type, provider);
  if (existing) {
    const [updated] = await db.update(secretsTable).set({ value }).where(eq(secretsTable.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(secretsTable).values({ userId, type, provider, value }).returning();
  return created;
}

export async function deleteSecretById(id: string) {
  await db.delete(secretsTable).where(eq(secretsTable.id, id));
}

export async function deleteSecretsByUser(userId: string) {
  await db.delete(secretsTable).where(eq(secretsTable.userId, userId));
}

export async function deleteSecretByUserTypeProvider(userId: string, type: string, provider: string) {
  await db
    .delete(secretsTable)
    .where(and(eq(secretsTable.userId, userId), eq(secretsTable.type, type), eq(secretsTable.provider, provider)));
}

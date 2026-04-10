import { and, eq } from 'drizzle-orm';
import { db } from '../index';
import type { NewUser } from '../schema/users';
import { usersTable } from '../schema/users';

const SYSTEM_WALLET = '0x0000000000000000000000000000000000000000';
const SYSTEM_CHAIN = 'system';

let systemUserIdPromise: Promise<string> | null = null;

export async function createUser(input: NewUser) {
  const [user] = await db.insert(usersTable).values(input).returning();
  return user;
}

export async function getOrCreateUserByWallet(walletAddress: string, chain: string) {
  const normalized = walletAddress.toLowerCase();
  const existing = await getUserByWallet(normalized, chain);
  if (existing) return existing;
  const [created] = await db.insert(usersTable).values({ walletAddress: normalized, chain }).returning();
  return created;
}

export async function getSystemUserId(): Promise<string> {
  if (!systemUserIdPromise) {
    systemUserIdPromise = (async () => {
      const row = await getOrCreateUserByWallet(SYSTEM_WALLET, SYSTEM_CHAIN);
      return row.id;
    })();
  }
  return systemUserIdPromise;
}

export async function getUserById(id: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  return user;
}

export async function getUserByWallet(walletAddress: string, chain: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.walletAddress, walletAddress), eq(usersTable.chain, chain)));
  return user;
}

export async function deleteUser(id: string) {
  await db.delete(usersTable).where(eq(usersTable.id, id));
}

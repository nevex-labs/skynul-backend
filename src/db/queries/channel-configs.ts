import { and, eq } from 'drizzle-orm';
import { db } from '../index';
import type { NewChannelConfig } from '../schema/channel-configs';
import { channelConfigsTable } from '../schema/channel-configs';

export async function getChannelConfig(userId: string, channelKey: string) {
  const [row] = await db
    .select()
    .from(channelConfigsTable)
    .where(and(eq(channelConfigsTable.userId, userId), eq(channelConfigsTable.channelKey, channelKey)));
  return row ?? null;
}

export async function upsertChannelConfig(
  userId: string,
  channelKey: string,
  state: Record<string, unknown>
): Promise<void> {
  const existing = await getChannelConfig(userId, channelKey);
  if (existing) {
    await db
      .update(channelConfigsTable)
      .set({ state, updatedAt: new Date() })
      .where(eq(channelConfigsTable.id, existing.id));
    return;
  }
  const input: NewChannelConfig = { userId, channelKey, state };
  await db.insert(channelConfigsTable).values(input);
}

export async function deleteChannelConfig(userId: string, channelKey: string): Promise<void> {
  await db
    .delete(channelConfigsTable)
    .where(and(eq(channelConfigsTable.userId, userId), eq(channelConfigsTable.channelKey, channelKey)));
}

import { deleteChannelConfig, upsertChannelConfig } from '../db/queries/channel-configs';
import { getSystemUserId } from '../db/queries/users';

export async function saveChannelConfig(channelKey: string, state: Record<string, unknown>): Promise<void> {
  const userId = await getSystemUserId();
  await upsertChannelConfig(userId, channelKey, state);
}

export async function removeChannelConfig(channelKey: string): Promise<void> {
  const userId = await getSystemUserId();
  await deleteChannelConfig(userId, channelKey);
}

import { getChannelConfig, upsertChannelConfig } from '../db/queries/channel-configs';
import { getSystemUserId } from '../db/queries/users';

export const CHANNEL_CONFIG_GLOBAL_KEY = 'global';

export async function readChannelConfigState(channelKey: string): Promise<Record<string, unknown> | null> {
  const uid = await getSystemUserId();
  const row = await getChannelConfig(uid, channelKey);
  if (!row) return null;
  const s = row.state;
  if (s === null || typeof s !== 'object' || Array.isArray(s)) return null;
  return s as Record<string, unknown>;
}

export async function writeChannelConfigState(channelKey: string, state: Record<string, unknown>): Promise<void> {
  const uid = await getSystemUserId();
  await upsertChannelConfig(uid, channelKey, state);
}

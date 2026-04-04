import { Context, Effect } from 'effect';
import type { ChannelGlobalSetting, ChannelSetting } from '../../infrastructure/db/schema';
import { ChannelNotFoundError, DatabaseError } from '../../shared/errors';
import type { ChannelId } from '../../shared/types';

export interface ChannelServiceApi {
  // Global settings
  readonly getGlobalSettings: () => Effect.Effect<ChannelGlobalSetting, DatabaseError>;
  readonly setAutoApprove: (enabled: boolean) => Effect.Effect<ChannelGlobalSetting, DatabaseError>;

  // Per-channel settings
  readonly getAllSettings: () => Effect.Effect<ChannelSetting[], DatabaseError>;
  readonly getChannelSettings: (
    channelId: ChannelId
  ) => Effect.Effect<ChannelSetting, DatabaseError | ChannelNotFoundError>;
  readonly setChannelEnabled: (
    channelId: ChannelId,
    enabled: boolean
  ) => Effect.Effect<ChannelSetting, DatabaseError | ChannelNotFoundError>;
  readonly setChannelCredentials: (
    channelId: ChannelId,
    credentials: Record<string, string>
  ) => Effect.Effect<void, DatabaseError | ChannelNotFoundError>;
  readonly generatePairingCode: (channelId: ChannelId) => Effect.Effect<string, DatabaseError | ChannelNotFoundError>;
  readonly unpairChannel: (channelId: ChannelId) => Effect.Effect<void, DatabaseError | ChannelNotFoundError>;

  // Initialize channels from DB (call at startup)
  readonly initializeChannels: () => Effect.Effect<void, DatabaseError>;
}

export class ChannelService extends Context.Tag('ChannelService')<ChannelService, ChannelServiceApi>() {}

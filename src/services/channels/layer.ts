import { eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { channelGlobalSettings, channelSettings } from '../../infrastructure/db/schema';
import { ChannelNotFoundError, DatabaseError } from '../../shared/errors';
import type { ChannelId } from '../../types';
import { DatabaseService } from '../database';
import { ChannelService } from './tag';

// Valid channel IDs
const VALID_CHANNELS: ChannelId[] = ['telegram', 'whatsapp', 'discord', 'signal', 'slack'];

export const ChannelServiceLive = Layer.effect(
  ChannelService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    // Ensure all channels exist in DB
    const initializeChannels = () =>
      Effect.gen(function* () {
        const existing = yield* Effect.tryPromise({
          try: async () => {
            const rows = await db.select({ channelId: channelSettings.channelId }).from(channelSettings);
            return new Set(rows.map((r) => r.channelId));
          },
          catch: (error) => new DatabaseError(error),
        });

        for (const channelId of VALID_CHANNELS) {
          if (!existing.has(channelId)) {
            yield* Effect.tryPromise({
              try: async () => {
                await db.insert(channelSettings).values({
                  channelId,
                  enabled: false,
                  status: 'disconnected',
                  paired: false,
                  hasCredentials: false,
                });
              },
              catch: (error) => new DatabaseError(error),
            });
          }
        }

        // Ensure global settings exist
        const globalSettings = yield* Effect.tryPromise({
          try: async () => {
            const [settings] = await db.select().from(channelGlobalSettings).limit(1);
            return settings;
          },
          catch: (error) => new DatabaseError(error),
        });

        if (!globalSettings) {
          yield* Effect.tryPromise({
            try: async () => {
              await db.insert(channelGlobalSettings).values({ autoApprove: true });
            },
            catch: (error) => new DatabaseError(error),
          });
        }
      });

    return ChannelService.of({
      initializeChannels,

      getGlobalSettings: () =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [settings] = await db.select().from(channelGlobalSettings).limit(1);
              return settings;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result) {
            // Create default
            const [created] = yield* Effect.tryPromise({
              try: async () => {
                return await db.insert(channelGlobalSettings).values({ autoApprove: true }).returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return created;
          }

          return result;
        }),

      setAutoApprove: (enabled) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [settings] = await db.select().from(channelGlobalSettings).limit(1);
              return settings;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (existing) {
            const [updated] = yield* Effect.tryPromise({
              try: async () => {
                return await db
                  .update(channelGlobalSettings)
                  .set({ autoApprove: enabled, updatedAt: new Date() })
                  .where(eq(channelGlobalSettings.id, existing.id))
                  .returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return updated;
          }

          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db.insert(channelGlobalSettings).values({ autoApprove: enabled }).returning();
            },
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),

      getAllSettings: () =>
        Effect.tryPromise({
          try: async () => {
            return await db.select().from(channelSettings).orderBy(channelSettings.channelId);
          },
          catch: (error) => new DatabaseError(error),
        }),

      getChannelSettings: (channelId) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [settings] = await db
                .select()
                .from(channelSettings)
                .where(eq(channelSettings.channelId, channelId))
                .limit(1);
              return settings;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result) {
            return yield* Effect.fail(new ChannelNotFoundError(channelId));
          }

          return result;
        }),

      setChannelEnabled: (channelId, enabled) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [settings] = await db
                .select()
                .from(channelSettings)
                .where(eq(channelSettings.channelId, channelId))
                .limit(1);
              return settings;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!existing) {
            return yield* Effect.fail(new ChannelNotFoundError(channelId));
          }

          const [updated] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .update(channelSettings)
                .set({ enabled, updatedAt: new Date() })
                .where(eq(channelSettings.id, existing.id))
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return updated;
        }),

      setChannelCredentials: (channelId, credentials) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [settings] = await db
                .select()
                .from(channelSettings)
                .where(eq(channelSettings.channelId, channelId))
                .limit(1);
              return settings;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!existing) {
            return yield* Effect.fail(new ChannelNotFoundError(channelId));
          }

          yield* Effect.tryPromise({
            try: async () => {
              await db
                .update(channelSettings)
                .set({
                  credentials,
                  hasCredentials: Object.keys(credentials).length > 0,
                  updatedAt: new Date(),
                })
                .where(eq(channelSettings.id, existing.id));
            },
            catch: (error) => new DatabaseError(error),
          });
        }),

      generatePairingCode: (channelId) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [settings] = await db
                .select()
                .from(channelSettings)
                .where(eq(channelSettings.channelId, channelId))
                .limit(1);
              return settings;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!existing) {
            return yield* Effect.fail(new ChannelNotFoundError(channelId));
          }

          // Generate a random pairing code
          const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();

          yield* Effect.tryPromise({
            try: async () => {
              await db
                .update(channelSettings)
                .set({ pairingCode, updatedAt: new Date() })
                .where(eq(channelSettings.id, existing.id));
            },
            catch: (error) => new DatabaseError(error),
          });

          return pairingCode;
        }),

      unpairChannel: (channelId) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [settings] = await db
                .select()
                .from(channelSettings)
                .where(eq(channelSettings.channelId, channelId))
                .limit(1);
              return settings;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!existing) {
            return yield* Effect.fail(new ChannelNotFoundError(channelId));
          }

          yield* Effect.tryPromise({
            try: async () => {
              await db
                .update(channelSettings)
                .set({
                  paired: false,
                  pairingCode: null,
                  updatedAt: new Date(),
                })
                .where(eq(channelSettings.id, existing.id));
            },
            catch: (error) => new DatabaseError(error),
          });
        }),
    });
  })
);

// Layer para testing
export const ChannelServiceTest = Layer.succeed(
  ChannelService,
  ChannelService.of({
    initializeChannels: () => Effect.succeed(undefined),
    getGlobalSettings: () => Effect.succeed({ id: 1, autoApprove: true, createdAt: new Date(), updatedAt: new Date() }),
    setAutoApprove: (enabled) =>
      Effect.succeed({ id: 1, autoApprove: enabled, createdAt: new Date(), updatedAt: new Date() }),
    getAllSettings: () =>
      Effect.succeed([
        {
          id: 1,
          channelId: 'telegram',
          enabled: false,
          status: 'disconnected',
          paired: false,
          pairingCode: null,
          error: null,
          hasCredentials: false,
          credentials: {},
          meta: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    getChannelSettings: (id) =>
      Effect.succeed({
        id: 1,
        channelId: id,
        enabled: false,
        status: 'disconnected',
        paired: false,
        pairingCode: null,
        error: null,
        hasCredentials: false,
        credentials: {},
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    setChannelEnabled: (id, enabled) =>
      Effect.succeed({
        id: 1,
        channelId: id,
        enabled,
        status: 'disconnected',
        paired: false,
        pairingCode: null,
        error: null,
        hasCredentials: false,
        credentials: {},
        meta: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    setChannelCredentials: () => Effect.succeed(undefined),
    generatePairingCode: () => Effect.succeed('ABC123'),
    unpairChannel: () => Effect.succeed(undefined),
  })
);

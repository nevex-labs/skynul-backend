import { eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { appSettings, tradingSettings } from '../../infrastructure/db/schema';
import { DatabaseError } from '../../shared/errors';
import { DatabaseService } from '../database';
import { type SettingsInput, SettingsService, type TradingSettingsInput } from './tag';

export const SettingsServiceLive = Layer.effect(
  SettingsService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    const buildUpdateValues = (settings: SettingsInput): Partial<typeof appSettings.$inferInsert> => {
      const values: Partial<typeof appSettings.$inferInsert> = { updatedAt: new Date() };
      if (settings.themeMode !== undefined) values.themeMode = settings.themeMode;
      if (settings.language !== undefined) values.language = settings.language;
      if (settings.taskMemoryEnabled !== undefined) values.taskMemoryEnabled = settings.taskMemoryEnabled;
      if (settings.taskAutoApprove !== undefined) values.taskAutoApprove = settings.taskAutoApprove;
      if (settings.provider) {
        if (settings.provider.active !== undefined) values.activeProvider = settings.provider.active;
        if (settings.provider.openaiModel !== undefined) values.openaiModel = settings.provider.openaiModel;
      }
      return values;
    };

    const getOrCreate = (userId: number) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: async () => {
            const [s] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
            return s;
          },
          catch: (error) => new DatabaseError(error),
        });
        if (result) return result;
        const [created] = yield* Effect.tryPromise({
          try: async () => db.insert(appSettings).values({ userId }).returning(),
          catch: (error) => new DatabaseError(error),
        });
        return created;
      });

    const update = (userId: number, values: Partial<typeof appSettings.$inferInsert>) =>
      Effect.gen(function* () {
        const existing = yield* getOrCreate(userId);
        const [updated] = yield* Effect.tryPromise({
          try: async () => db.update(appSettings).set(values).where(eq(appSettings.id, existing.id)).returning(),
          catch: (error) => new DatabaseError(error),
        });
        return updated;
      });

    return SettingsService.of({
      getSettings: getOrCreate,
      updateSettings: (userId, settings) => update(userId, buildUpdateValues(settings)),
      updateTheme: (userId, themeMode) => update(userId, { themeMode }),
      updateLanguage: (userId, language) => update(userId, { language }),
      updateProvider: (userId, active) => update(userId, { activeProvider: active }),
      updateProviderModel: (userId, model) => update(userId, { openaiModel: model }),
      updateTaskMemory: (userId, enabled) => update(userId, { taskMemoryEnabled: enabled }),
      updateTaskAutoApprove: (userId, enabled) => update(userId, { taskAutoApprove: enabled }),
      updatePaperTrading: (userId, enabled) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(tradingSettings).where(eq(tradingSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          const values: Partial<typeof tradingSettings.$inferInsert> = {
            updatedAt: new Date(),
            paperTrading: enabled,
          };

          if (existing) {
            return yield* Effect.tryPromise({
              try: async () =>
                db
                  .update(tradingSettings)
                  .set(values)
                  .where(eq(tradingSettings.id, existing.id))
                  .returning()
                  .then((r) => r[0]),
              catch: (error) => new DatabaseError(error),
            });
          }
          return yield* Effect.tryPromise({
            try: async () =>
              db
                .insert(tradingSettings)
                .values({ userId, ...values })
                .returning()
                .then((r) => r[0]),
            catch: (error) => new DatabaseError(error),
          });
        }),

      // Trading Settings
      getTradingSettings: (userId) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(tradingSettings).where(eq(tradingSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });
          if (result) return result;
          const [created] = yield* Effect.tryPromise({
            try: async () => db.insert(tradingSettings).values({ userId }).returning(),
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),

      updateTradingSettings: (userId, input) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(tradingSettings).where(eq(tradingSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          const values: Partial<typeof tradingSettings.$inferInsert> = { updatedAt: new Date() };
          if (input.paperTrading !== undefined) values.paperTrading = input.paperTrading;
          if (input.autoApprove !== undefined) values.autoApprove = input.autoApprove;
          if (input.cexProviders !== undefined) values.cexProviders = input.cexProviders;
          if (input.dexProviders !== undefined) values.dexProviders = input.dexProviders;
          if (input.chainConfigs !== undefined) values.chainConfigs = input.chainConfigs;

          if (existing) {
            return yield* Effect.tryPromise({
              try: async () =>
                db
                  .update(tradingSettings)
                  .set(values)
                  .where(eq(tradingSettings.id, existing.id))
                  .returning()
                  .then((r) => r[0]),
              catch: (error) => new DatabaseError(error),
            });
          }
          return yield* Effect.tryPromise({
            try: async () =>
              db
                .insert(tradingSettings)
                .values({ userId, ...values })
                .returning()
                .then((r) => r[0]),
            catch: (error) => new DatabaseError(error),
          });
        }),
    });
  })
);

// Test layer
const TEST_SETTING = {
  id: 1,
  userId: 1,
  themeMode: 'dark',
  language: 'en',
  activeProvider: 'chatgpt',
  openaiModel: 'gpt-4.1-mini',
  taskMemoryEnabled: true,
  taskAutoApprove: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const SettingsServiceTest = Layer.succeed(
  SettingsService,
  SettingsService.of({
    getSettings: () => Effect.succeed(TEST_SETTING),
    updateSettings: () => Effect.succeed(TEST_SETTING),
    updateTheme: () => Effect.succeed(TEST_SETTING),
    updateLanguage: () => Effect.succeed(TEST_SETTING),
    updateProvider: () => Effect.succeed(TEST_SETTING),
    updateProviderModel: () => Effect.succeed(TEST_SETTING),
    updateTaskMemory: () => Effect.succeed(TEST_SETTING),
    updateTaskAutoApprove: () => Effect.succeed(TEST_SETTING),
    updatePaperTrading: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        paperTrading: true,
        autoApprove: false,
        cexProviders: [],
        dexProviders: [],
        chainConfigs: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    getTradingSettings: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        paperTrading: true,
        autoApprove: false,
        cexProviders: [],
        dexProviders: [],
        chainConfigs: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    updateTradingSettings: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        paperTrading: true,
        autoApprove: false,
        cexProviders: [],
        dexProviders: [],
        chainConfigs: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
  })
);

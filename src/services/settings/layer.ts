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

    // Helper function to build update values from SettingsInput
    const buildUpdateValues = (settings: SettingsInput): Partial<typeof appSettings.$inferInsert> => {
      const values: Partial<typeof appSettings.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (settings.workspaceRoot !== undefined) values.workspaceRoot = settings.workspaceRoot;
      if (settings.themeMode !== undefined) values.themeMode = settings.themeMode;
      if (settings.language !== undefined) values.language = settings.language;
      if (settings.taskMemoryEnabled !== undefined) values.taskMemoryEnabled = settings.taskMemoryEnabled;
      if (settings.taskAutoApprove !== undefined) values.taskAutoApprove = settings.taskAutoApprove;
      if (settings.paperTradingEnabled !== undefined) values.paperTradingEnabled = settings.paperTradingEnabled;

      if (settings.capabilities) {
        if (settings.capabilities['fs.read'] !== undefined) values.capabilityFsRead = settings.capabilities['fs.read'];
        if (settings.capabilities['fs.write'] !== undefined)
          values.capabilityFsWrite = settings.capabilities['fs.write'];
        if (settings.capabilities['cmd.run'] !== undefined) values.capabilityCmdRun = settings.capabilities['cmd.run'];
        if (settings.capabilities['net.http'] !== undefined)
          values.capabilityNetHttp = settings.capabilities['net.http'];
      }

      if (settings.provider) {
        if (settings.provider.active !== undefined) values.activeProvider = settings.provider.active;
        if (settings.provider.openaiModel !== undefined) values.openaiModel = settings.provider.openaiModel;
      }

      return values;
    };

    return SettingsService.of({
      // App Settings
      getSettings: (userId) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [setting] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
              return setting;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (result) {
            return result;
          }

          // Create default settings
          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db.insert(appSettings).values({ userId }).returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return created;
        }),

      updateSettings: (userId, settings) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          const values = buildUpdateValues(settings);

          if (existing) {
            const [updated] = yield* Effect.tryPromise({
              try: async () => {
                return await db.update(appSettings).set(values).where(eq(appSettings.id, existing.id)).returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return updated;
          }

          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(appSettings)
                .values({ userId, ...values })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),

      updateCapability: (userId, capability, enabled) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          const values: Partial<typeof appSettings.$inferInsert> = {
            updatedAt: new Date(),
          };

          if (capability === 'fs.read') values.capabilityFsRead = enabled;
          if (capability === 'fs.write') values.capabilityFsWrite = enabled;
          if (capability === 'cmd.run') values.capabilityCmdRun = enabled;
          if (capability === 'net.http') values.capabilityNetHttp = enabled;

          if (existing) {
            const [updated] = yield* Effect.tryPromise({
              try: async () => {
                return await db.update(appSettings).set(values).where(eq(appSettings.id, existing.id)).returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return updated;
          }

          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(appSettings)
                .values({ userId, ...values })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),

      updateTheme: (userId, themeMode) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          const values: Partial<typeof appSettings.$inferInsert> = {
            updatedAt: new Date(),
            themeMode,
          };

          if (existing) {
            const [updated] = yield* Effect.tryPromise({
              try: async () => {
                return await db.update(appSettings).set(values).where(eq(appSettings.id, existing.id)).returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return updated;
          }

          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(appSettings)
                .values({ userId, ...values })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),

      updateLanguage: (userId, language) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          const values: Partial<typeof appSettings.$inferInsert> = {
            updatedAt: new Date(),
            language,
          };

          if (existing) {
            const [updated] = yield* Effect.tryPromise({
              try: async () => {
                return await db.update(appSettings).set(values).where(eq(appSettings.id, existing.id)).returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return updated;
          }

          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(appSettings)
                .values({ userId, ...values })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),

      updateProvider: (userId, active) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          const values: Partial<typeof appSettings.$inferInsert> = {
            updatedAt: new Date(),
            activeProvider: active,
          };

          if (existing) {
            const [updated] = yield* Effect.tryPromise({
              try: async () => {
                return await db.update(appSettings).set(values).where(eq(appSettings.id, existing.id)).returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return updated;
          }

          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(appSettings)
                .values({ userId, ...values })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),

      updateProviderModel: (userId, model) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          const values: Partial<typeof appSettings.$inferInsert> = {
            updatedAt: new Date(),
            openaiModel: model,
          };

          if (existing) {
            const [updated] = yield* Effect.tryPromise({
              try: async () => {
                return await db.update(appSettings).set(values).where(eq(appSettings.id, existing.id)).returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return updated;
          }

          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(appSettings)
                .values({ userId, ...values })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),

      updateTaskMemory: (userId, enabled) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          const values: Partial<typeof appSettings.$inferInsert> = {
            updatedAt: new Date(),
            taskMemoryEnabled: enabled,
          };

          if (existing) {
            const [updated] = yield* Effect.tryPromise({
              try: async () => {
                return await db.update(appSettings).set(values).where(eq(appSettings.id, existing.id)).returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return updated;
          }

          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(appSettings)
                .values({ userId, ...values })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),

      updateTaskAutoApprove: (userId, enabled) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          const values: Partial<typeof appSettings.$inferInsert> = {
            updatedAt: new Date(),
            taskAutoApprove: enabled,
          };

          if (existing) {
            const [updated] = yield* Effect.tryPromise({
              try: async () => {
                return await db.update(appSettings).set(values).where(eq(appSettings.id, existing.id)).returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return updated;
          }

          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(appSettings)
                .values({ userId, ...values })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),

      updatePaperTrading: (userId, enabled) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          const values: Partial<typeof appSettings.$inferInsert> = {
            updatedAt: new Date(),
            paperTradingEnabled: enabled,
          };

          if (existing) {
            const [updated] = yield* Effect.tryPromise({
              try: async () => {
                return await db.update(appSettings).set(values).where(eq(appSettings.id, existing.id)).returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return updated;
          }

          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(appSettings)
                .values({ userId, ...values })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),

      updateWorkspace: (userId, path) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(appSettings).where(eq(appSettings.userId, userId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          const values: Partial<typeof appSettings.$inferInsert> = {
            updatedAt: new Date(),
            workspaceRoot: path,
          };

          if (existing) {
            const [updated] = yield* Effect.tryPromise({
              try: async () => {
                return await db.update(appSettings).set(values).where(eq(appSettings.id, existing.id)).returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return updated;
          }

          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(appSettings)
                .values({ userId, ...values })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),

      // Trading Settings
      getTradingSettings: (userId) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [setting] = await db
                .select()
                .from(tradingSettings)
                .where(eq(tradingSettings.userId, userId))
                .limit(1);
              return setting;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (result) {
            return result;
          }

          // Create default trading settings
          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db.insert(tradingSettings).values({ userId }).returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return created;
        }),

      updateTradingSettings: (userId, settings) =>
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
          };

          if (settings.paperTrading !== undefined) values.paperTrading = settings.paperTrading;
          if (settings.autoApprove !== undefined) values.autoApprove = settings.autoApprove;
          if (settings.cexProviders !== undefined) values.cexProviders = settings.cexProviders;
          if (settings.dexProviders !== undefined) values.dexProviders = settings.dexProviders;
          if (settings.chainConfigs !== undefined) values.chainConfigs = settings.chainConfigs;

          if (existing) {
            const [updated] = yield* Effect.tryPromise({
              try: async () => {
                return await db
                  .update(tradingSettings)
                  .set(values)
                  .where(eq(tradingSettings.id, existing.id))
                  .returning();
              },
              catch: (error) => new DatabaseError(error),
            });
            return updated;
          }

          const [created] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(tradingSettings)
                .values({ userId, ...values })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });
          return created;
        }),
    });
  })
);

// Layer para testing
export const SettingsServiceTest = Layer.succeed(
  SettingsService,
  SettingsService.of({
    getSettings: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        capabilityFsRead: false,
        capabilityFsWrite: false,
        capabilityCmdRun: false,
        capabilityNetHttp: true,
        themeMode: 'dark',
        language: 'en',
        activeProvider: 'chatgpt',
        openaiModel: 'gpt-4.1-mini',
        taskMemoryEnabled: true,
        taskAutoApprove: false,
        paperTradingEnabled: false,
        workspaceRoot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    updateSettings: (userId, settings) =>
      Effect.succeed({
        id: 1,
        userId,
        capabilityFsRead: settings.capabilities?.['fs.read'] ?? false,
        capabilityFsWrite: settings.capabilities?.['fs.write'] ?? false,
        capabilityCmdRun: settings.capabilities?.['cmd.run'] ?? false,
        capabilityNetHttp: settings.capabilities?.['net.http'] ?? true,
        themeMode: (settings.themeMode as any) ?? 'dark',
        language: (settings.language as any) ?? 'en',
        activeProvider: settings.provider?.active ?? 'chatgpt',
        openaiModel: settings.provider?.openaiModel ?? 'gpt-4.1-mini',
        taskMemoryEnabled: settings.taskMemoryEnabled ?? true,
        taskAutoApprove: settings.taskAutoApprove ?? false,
        paperTradingEnabled: settings.paperTradingEnabled ?? false,
        workspaceRoot: settings.workspaceRoot ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    updateCapability: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        capabilityFsRead: false,
        capabilityFsWrite: false,
        capabilityCmdRun: false,
        capabilityNetHttp: true,
        themeMode: 'dark',
        language: 'en',
        activeProvider: 'chatgpt',
        openaiModel: 'gpt-4.1-mini',
        taskMemoryEnabled: true,
        taskAutoApprove: false,
        paperTradingEnabled: false,
        workspaceRoot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    updateTheme: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        capabilityFsRead: false,
        capabilityFsWrite: false,
        capabilityCmdRun: false,
        capabilityNetHttp: true,
        themeMode: 'dark',
        language: 'en',
        activeProvider: 'chatgpt',
        openaiModel: 'gpt-4.1-mini',
        taskMemoryEnabled: true,
        taskAutoApprove: false,
        paperTradingEnabled: false,
        workspaceRoot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    updateLanguage: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        capabilityFsRead: false,
        capabilityFsWrite: false,
        capabilityCmdRun: false,
        capabilityNetHttp: true,
        themeMode: 'dark',
        language: 'en',
        activeProvider: 'chatgpt',
        openaiModel: 'gpt-4.1-mini',
        taskMemoryEnabled: true,
        taskAutoApprove: false,
        paperTradingEnabled: false,
        workspaceRoot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    updateProvider: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        capabilityFsRead: false,
        capabilityFsWrite: false,
        capabilityCmdRun: false,
        capabilityNetHttp: true,
        themeMode: 'dark',
        language: 'en',
        activeProvider: 'chatgpt',
        openaiModel: 'gpt-4.1-mini',
        taskMemoryEnabled: true,
        taskAutoApprove: false,
        paperTradingEnabled: false,
        workspaceRoot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    updateProviderModel: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        capabilityFsRead: false,
        capabilityFsWrite: false,
        capabilityCmdRun: false,
        capabilityNetHttp: true,
        themeMode: 'dark',
        language: 'en',
        activeProvider: 'chatgpt',
        openaiModel: 'gpt-4.1-mini',
        taskMemoryEnabled: true,
        taskAutoApprove: false,
        paperTradingEnabled: false,
        workspaceRoot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    updateTaskMemory: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        capabilityFsRead: false,
        capabilityFsWrite: false,
        capabilityCmdRun: false,
        capabilityNetHttp: true,
        themeMode: 'dark',
        language: 'en',
        activeProvider: 'chatgpt',
        openaiModel: 'gpt-4.1-mini',
        taskMemoryEnabled: true,
        taskAutoApprove: false,
        paperTradingEnabled: false,
        workspaceRoot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    updateTaskAutoApprove: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        capabilityFsRead: false,
        capabilityFsWrite: false,
        capabilityCmdRun: false,
        capabilityNetHttp: true,
        themeMode: 'dark',
        language: 'en',
        activeProvider: 'chatgpt',
        openaiModel: 'gpt-4.1-mini',
        taskMemoryEnabled: true,
        taskAutoApprove: false,
        paperTradingEnabled: false,
        workspaceRoot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    updatePaperTrading: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        capabilityFsRead: false,
        capabilityFsWrite: false,
        capabilityCmdRun: false,
        capabilityNetHttp: true,
        themeMode: 'dark',
        language: 'en',
        activeProvider: 'chatgpt',
        openaiModel: 'gpt-4.1-mini',
        taskMemoryEnabled: true,
        taskAutoApprove: false,
        paperTradingEnabled: false,
        workspaceRoot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    updateWorkspace: () =>
      Effect.succeed({
        id: 1,
        userId: 1,
        capabilityFsRead: false,
        capabilityFsWrite: false,
        capabilityCmdRun: false,
        capabilityNetHttp: true,
        themeMode: 'dark',
        language: 'en',
        activeProvider: 'chatgpt',
        openaiModel: 'gpt-4.1-mini',
        taskMemoryEnabled: true,
        taskAutoApprove: false,
        paperTradingEnabled: false,
        workspaceRoot: null,
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

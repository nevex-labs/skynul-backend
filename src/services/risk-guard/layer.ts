import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import {
  DEFAULT_MODE_CONFIG,
  DEFAULT_RISK_CONFIG,
  DEFAULT_RISK_LIMITS,
  type ExitTrigger,
  type RiskCheckResult,
  type RiskConfig,
  type RiskLimits,
  type RiskPositionDto,
  type TradingMode,
  type VenueId,
  type YoloCheckResult,
  riskDailyVolume,
  riskPositions,
  yoloTrades,
} from '../../infrastructure/db/schema/risk-guard';
import { DatabaseError } from '../../shared/errors';
import { DatabaseService } from '../database/tag';
import { RiskGuardService } from './tag';

// Config file path (per user)
function configFilePath(userId: number): string {
  // In production, use a proper data directory
  const dataDir = process.env.DATA_DIR || './data';
  return join(dataDir, `risk-${userId}.json`);
}

// Helper to convert DB row to DTO
function toPositionDto(row: typeof riskPositions.$inferSelect): RiskPositionDto {
  return {
    id: row.id,
    venue: row.venue,
    symbol: row.symbol,
    side: row.side,
    sizeUsd: row.sizeUsd,
    taskId: row.taskId ?? null,
    openedAt: row.openedAt?.getTime() ?? Date.now(),
    closedAt: row.closedAt?.getTime() ?? null,
    mode: (row.mode as TradingMode) ?? 'task',
    entryPrice: row.entryPrice ?? undefined,
    exitPrice: row.exitPrice ?? undefined,
    pnlUsd: row.pnlUsd ?? undefined,
  };
}

// Helper to get today's date key
function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

export const RiskGuardServiceLive = Layer.effect(
  RiskGuardService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    return RiskGuardService.of({
      checkTradeAllowed: (userId: number, venue: VenueId, amountUsd: number) =>
        Effect.gen(function* () {
          const config = yield* Effect.try({
            try: () => {
              try {
                const raw = readFileSync(configFilePath(userId), 'utf8');
                const parsed = JSON.parse(raw) as Partial<RiskConfig>;
                return {
                  global: { ...DEFAULT_RISK_LIMITS, ...(parsed.global ?? {}) },
                  venues: parsed.venues ?? {},
                };
              } catch {
                return { ...DEFAULT_RISK_CONFIG };
              }
            },
            catch: (error) => new DatabaseError(error),
          });

          const limits = config.venues[venue] ?? config.global;

          if (!limits.enabled) {
            return { allowed: true } as RiskCheckResult;
          }

          const maxSingleTrade = limits.maxSingleTradeUsd ?? DEFAULT_RISK_LIMITS.maxSingleTradeUsd;
          if (amountUsd > maxSingleTrade) {
            return {
              allowed: false,
              reason: `Trade size $${amountUsd.toFixed(2)} exceeds max single trade limit of $${maxSingleTrade} on ${venue}. Reduce trade size.`,
            } as RiskCheckResult;
          }

          const dailyVol = yield* Effect.tryPromise({
            try: async () => {
              const date = todayKey();
              const [row] = await db
                .select({ volumeUsd: riskDailyVolume.volumeUsd })
                .from(riskDailyVolume)
                .where(
                  and(
                    eq(riskDailyVolume.userId, userId),
                    eq(riskDailyVolume.date, date),
                    eq(riskDailyVolume.venue, venue)
                  )
                )
                .limit(1);
              return row?.volumeUsd ?? 0;
            },
            catch: (error) => new DatabaseError(error),
          });

          const maxDailyVolume = limits.maxDailyVolumeUsd ?? DEFAULT_RISK_LIMITS.maxDailyVolumeUsd;
          if (dailyVol + amountUsd > maxDailyVolume) {
            const remaining = Math.max(0, maxDailyVolume - dailyVol);
            return {
              allowed: false,
              reason: `Daily volume limit reached on ${venue}. Used $${dailyVol.toFixed(2)} of $${maxDailyVolume} today. Remaining: $${remaining.toFixed(2)}.`,
            } as RiskCheckResult;
          }

          const openCount = yield* Effect.tryPromise({
            try: async () => {
              const [result] = await db
                .select({ count: sql<number>`count(*)` })
                .from(riskPositions)
                .where(
                  and(eq(riskPositions.userId, userId), eq(riskPositions.venue, venue), isNull(riskPositions.closedAt))
                );
              return result?.count ?? 0;
            },
            catch: (error) => new DatabaseError(error),
          });

          const maxPositions = limits.maxConcurrentPositions ?? DEFAULT_RISK_LIMITS.maxConcurrentPositions;
          if (openCount >= maxPositions) {
            return {
              allowed: false,
              reason: `Max ${maxPositions} concurrent positions reached on ${venue}. Close existing positions before opening new ones.`,
            } as RiskCheckResult;
          }

          return { allowed: true } as RiskCheckResult;
        }),

      getEffectiveLimits: (userId: number, venue: VenueId) =>
        Effect.try({
          try: () => {
            try {
              const raw = readFileSync(configFilePath(userId), 'utf8');
              const parsed = JSON.parse(raw) as Partial<RiskConfig>;
              const config = {
                global: { ...DEFAULT_RISK_LIMITS, ...(parsed.global ?? {}) },
                venues: parsed.venues ?? {},
              };
              return { ...config.global, ...(config.venues[venue] ?? {}) };
            } catch {
              return { ...DEFAULT_RISK_LIMITS };
            }
          },
          catch: (error) => new DatabaseError(error),
        }),

      getDailyVolume: (userId: number, venue?: VenueId) =>
        Effect.tryPromise({
          try: async () => {
            const date = todayKey();

            if (venue) {
              const [row] = await db
                .select({ volumeUsd: riskDailyVolume.volumeUsd })
                .from(riskDailyVolume)
                .where(
                  and(
                    eq(riskDailyVolume.userId, userId),
                    eq(riskDailyVolume.date, date),
                    eq(riskDailyVolume.venue, venue)
                  )
                )
                .limit(1);
              return row?.volumeUsd ?? 0;
            }

            const [result] = await db
              .select({ total: sql<number>`sum(${riskDailyVolume.volumeUsd})` })
              .from(riskDailyVolume)
              .where(and(eq(riskDailyVolume.userId, userId), eq(riskDailyVolume.date, date)));

            return result?.total ?? 0;
          },
          catch: (error) => new DatabaseError(error),
        }),

      recordTradeVolume: (userId: number, venue: VenueId, amountUsd: number) =>
        Effect.tryPromise({
          try: async () => {
            const date = todayKey();

            // Try to update existing record
            const [existing] = await db
              .select()
              .from(riskDailyVolume)
              .where(
                and(
                  eq(riskDailyVolume.userId, userId),
                  eq(riskDailyVolume.date, date),
                  eq(riskDailyVolume.venue, venue)
                )
              )
              .limit(1);

            if (existing) {
              await db
                .update(riskDailyVolume)
                .set({
                  volumeUsd: existing.volumeUsd + amountUsd,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(riskDailyVolume.userId, userId),
                    eq(riskDailyVolume.date, date),
                    eq(riskDailyVolume.venue, venue)
                  )
                );
            } else {
              await db.insert(riskDailyVolume).values({
                userId,
                date,
                venue,
                volumeUsd: amountUsd,
              });
            }
          },
          catch: (error) => new DatabaseError(error),
        }),

      getOpenPositionCount: (userId: number, venue?: VenueId) =>
        Effect.tryPromise({
          try: async () => {
            if (venue) {
              const [result] = await db
                .select({ count: sql<number>`count(*)` })
                .from(riskPositions)
                .where(
                  and(eq(riskPositions.userId, userId), eq(riskPositions.venue, venue), isNull(riskPositions.closedAt))
                );
              return result?.count ?? 0;
            }

            const [result] = await db
              .select({ count: sql<number>`count(*)` })
              .from(riskPositions)
              .where(and(eq(riskPositions.userId, userId), isNull(riskPositions.closedAt)));

            return result?.count ?? 0;
          },
          catch: (error) => new DatabaseError(error),
        }),

      getOpenPositions: (userId: number, venue?: VenueId) =>
        Effect.tryPromise({
          try: async () => {
            let rows: (typeof riskPositions.$inferSelect)[];

            if (venue) {
              rows = await db
                .select()
                .from(riskPositions)
                .where(
                  and(eq(riskPositions.userId, userId), eq(riskPositions.venue, venue), isNull(riskPositions.closedAt))
                )
                .orderBy(sql`${riskPositions.openedAt} DESC`);
            } else {
              rows = await db
                .select()
                .from(riskPositions)
                .where(and(eq(riskPositions.userId, userId), isNull(riskPositions.closedAt)))
                .orderBy(sql`${riskPositions.openedAt} DESC`);
            }

            return rows.map(toPositionDto);
          },
          catch: (error) => new DatabaseError(error),
        }),

      openRiskPosition: (
        userId: number,
        venue: VenueId,
        symbol: string,
        side: string,
        sizeUsd: number,
        taskId?: string,
        mode?: TradingMode,
        entryPrice?: number
      ) =>
        Effect.gen(function* () {
          const [result] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(riskPositions)
                .values({
                  userId,
                  venue,
                  symbol,
                  side,
                  sizeUsd,
                  taskId,
                  mode: mode ?? 'task',
                  entryPrice,
                })
                .returning({ id: riskPositions.id });
            },
            catch: (error) => new DatabaseError(error),
          });

          // If YOLO mode, also track in yolo_trades
          if (mode === 'yolo' && entryPrice) {
            yield* Effect.tryPromise({
              try: async () => {
                await db.insert(yoloTrades).values({
                  userId,
                  token: symbol,
                  chain: venue,
                  side,
                  sizeUsd,
                  entryPrice,
                  taskId,
                });
              },
              catch: (error) => new DatabaseError(error),
            });
          }

          return result.id;
        }),

      closeRiskPosition: (userId: number, positionId: number, exitPrice?: number, exitReason?: string) =>
        Effect.gen(function* () {
          // Get position details
          const [position] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select()
                .from(riskPositions)
                .where(and(eq(riskPositions.id, positionId), eq(riskPositions.userId, userId)))
                .limit(1);
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!position) return;

          // Calculate P&L
          let pnlUsd: number | null = null;
          if (exitPrice && position.entryPrice) {
            const priceDiff = exitPrice - position.entryPrice;
            pnlUsd =
              position.side === 'buy'
                ? position.sizeUsd * (priceDiff / position.entryPrice)
                : position.sizeUsd * (-priceDiff / position.entryPrice);
          }

          yield* Effect.tryPromise({
            try: async () => {
              await db
                .update(riskPositions)
                .set({
                  closedAt: new Date(),
                  exitPrice,
                  pnlUsd,
                })
                .where(and(eq(riskPositions.id, positionId), eq(riskPositions.userId, userId)));
            },
            catch: (error) => new DatabaseError(error),
          });

          // Update yolo_trades if applicable
          if (position.mode === 'yolo' && exitPrice && position.taskId) {
            const taskId = position.taskId; // Type narrowing
            yield* Effect.tryPromise({
              try: async () => {
                await db
                  .update(yoloTrades)
                  .set({
                    exitPrice,
                    pnlUsd,
                    closedAt: new Date(),
                    exitReason: exitReason ?? 'manual',
                  })
                  .where(
                    and(
                      eq(yoloTrades.userId, userId),
                      eq(yoloTrades.taskId, taskId),
                      eq(yoloTrades.token, position.symbol),
                      isNull(yoloTrades.closedAt)
                    )
                  );
              },
              catch: (error) => new DatabaseError(error),
            });
          }
        }),

      closeAllPositionsForTask: (userId: number, taskId: string) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(riskPositions)
              .set({ closedAt: new Date() })
              .where(
                and(eq(riskPositions.userId, userId), eq(riskPositions.taskId, taskId), isNull(riskPositions.closedAt))
              );
          },
          catch: (error) => new DatabaseError(error),
        }),

      checkYoloEntryCriteria: (
        userId: number,
        tokenInfo: {
          liquidityUsd: number;
          uniqueHolders: number;
          topHolderPercent: number;
          devHoldingPercent: number;
          mintAuthority?: boolean;
          freezeAuthority?: boolean;
          ageMinutes: number;
        },
        mode?: TradingMode
      ) =>
        Effect.sync((): YoloCheckResult => {
          if (mode !== 'yolo') return { allowed: true };

          const config = DEFAULT_MODE_CONFIG.yolo;

          // Liquidity check
          if (config.minLiquidityUsd && tokenInfo.liquidityUsd < config.minLiquidityUsd) {
            return {
              allowed: false,
              reason: `Liquidity $${tokenInfo.liquidityUsd.toFixed(0)} below minimum $${config.minLiquidityUsd}`,
              suggestedFix: 'Skip this token - too illiquid',
            };
          }

          // Holder distribution
          if (tokenInfo.uniqueHolders < 100) {
            return {
              allowed: false,
              reason: `Only ${tokenInfo.uniqueHolders} holders - too few`,
              suggestedFix: 'Wait for more distribution',
            };
          }

          if (tokenInfo.topHolderPercent > 20) {
            return {
              allowed: false,
              reason: `Top holder owns ${tokenInfo.topHolderPercent.toFixed(1)}% - whale risk`,
              suggestedFix: 'High risk of dump',
            };
          }

          // Dev holding
          if (tokenInfo.devHoldingPercent > 10) {
            return {
              allowed: false,
              reason: `Dev holds ${tokenInfo.devHoldingPercent.toFixed(1)}% - rug risk`,
              suggestedFix: 'Dev can dump anytime',
            };
          }

          // Contract safety
          if (tokenInfo.mintAuthority === true) {
            return {
              allowed: false,
              reason: 'Mint authority enabled - infinite inflation risk',
              suggestedFix: 'Token can be inflated',
            };
          }

          if (tokenInfo.freezeAuthority === true) {
            return {
              allowed: false,
              reason: 'Freeze authority enabled - wallet lock risk',
              suggestedFix: 'Wallets can be frozen',
            };
          }

          // Age check
          if (tokenInfo.ageMinutes > 30) {
            return {
              allowed: false,
              reason: `Token is ${tokenInfo.ageMinutes} minutes old - too late`,
              suggestedFix: 'Only enter within first 30 min',
            };
          }

          return { allowed: true };
        }),

      checkDailyLossLimit: (userId: number, mode?: TradingMode) =>
        Effect.sync((): YoloCheckResult => {
          if (mode !== 'yolo') return { allowed: true };

          const config = DEFAULT_MODE_CONFIG.yolo;
          if (!config.maxDailyLossUsd) return { allowed: true };

          // Note: In a real implementation, we'd query the DB for daily PnL
          // For now, returning allowed (to be implemented with proper aggregation)
          return { allowed: true };
        }),

      checkTradeCooldown: (userId: number, mode?: TradingMode) =>
        Effect.sync((): YoloCheckResult => {
          if (mode !== 'yolo') return { allowed: true };

          const config = DEFAULT_MODE_CONFIG.yolo;
          if (!config.tradeCooldownSeconds) return { allowed: true };

          // Note: In a real implementation, we'd query the DB for last trade time
          // For now, returning allowed (to be implemented with proper query)
          return { allowed: true };
        }),

      checkExitTriggers: (
        userId: number,
        position: {
          entryPrice: number;
          currentPrice: number;
          sizeUsd: number;
          openedAt: number;
        },
        mode?: TradingMode
      ) =>
        Effect.sync((): ExitTrigger | null => {
          if (mode !== 'yolo') return null;

          const config = DEFAULT_MODE_CONFIG.yolo;
          const holdTime = (Date.now() - position.openedAt) / 1000;

          // Time limit
          if (config.maxHoldTimeSeconds && holdTime > config.maxHoldTimeSeconds) {
            return {
              type: 'time_limit',
              holdTimeSeconds: holdTime,
            };
          }

          // P&L calculation
          const pnlPercent = (position.currentPrice - position.entryPrice) / position.entryPrice;
          const pnlUsd = position.sizeUsd * pnlPercent;

          // Take profit
          if (config.takeProfitPercent && pnlPercent >= config.takeProfitPercent) {
            return {
              type: 'take_profit',
              profitPercent: pnlPercent,
              profitUsd: pnlUsd,
            };
          }

          // Stop loss
          if (config.stopLossPercent && pnlPercent <= -config.stopLossPercent) {
            return {
              type: 'stop_loss',
              lossPercent: Math.abs(pnlPercent),
              lossUsd: Math.abs(pnlUsd),
            };
          }

          return null;
        }),

      loadRiskConfig: (userId: number) =>
        Effect.try({
          try: () => {
            try {
              const raw = readFileSync(configFilePath(userId), 'utf8');
              const parsed = JSON.parse(raw) as Partial<RiskConfig>;
              return {
                global: { ...DEFAULT_RISK_LIMITS, ...(parsed.global ?? {}) },
                venues: parsed.venues ?? {},
              };
            } catch {
              return { ...DEFAULT_RISK_CONFIG };
            }
          },
          catch: (error) => new DatabaseError(error),
        }),

      saveRiskConfig: (userId: number, config: RiskConfig) =>
        Effect.try({
          try: () => {
            const f = configFilePath(userId);
            mkdirSync(dirname(f), { recursive: true });
            writeFileSync(f, JSON.stringify(config, null, 2), 'utf8');
          },
          catch: (error) => new DatabaseError(error),
        }),
    });
  })
);

// Layer para testing
export const RiskGuardServiceTest = Layer.succeed(
  RiskGuardService,
  RiskGuardService.of({
    checkTradeAllowed: () => Effect.succeed({ allowed: true }),
    getEffectiveLimits: () => Effect.succeed({ ...DEFAULT_RISK_LIMITS }),
    getDailyVolume: () => Effect.succeed(0),
    recordTradeVolume: () => Effect.succeed(undefined),
    getOpenPositionCount: () => Effect.succeed(0),
    getOpenPositions: () => Effect.succeed([]),
    openRiskPosition: () => Effect.succeed(1),
    closeRiskPosition: () => Effect.succeed(undefined),
    closeAllPositionsForTask: () => Effect.succeed(undefined),
    checkYoloEntryCriteria: () => Effect.succeed({ allowed: true }),
    checkDailyLossLimit: () => Effect.succeed({ allowed: true }),
    checkTradeCooldown: () => Effect.succeed({ allowed: true }),
    checkExitTriggers: () => Effect.succeed(null),
    loadRiskConfig: () => Effect.succeed({ ...DEFAULT_RISK_CONFIG }),
    saveRiskConfig: () => Effect.succeed(undefined),
  })
);

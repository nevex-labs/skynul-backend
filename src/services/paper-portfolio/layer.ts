import { and, eq, sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import {
  type PaperBalanceDto,
  type PaperPortfolioSummary,
  type PaperPosition,
  type PaperTradeDto,
  type PaperTradeInput,
  STARTING_USDC,
  type SwapSimulationParams,
  type SwapSimulationResult,
  paperBalances,
  paperTrades,
} from '../../infrastructure/db/schema/paper-portfolio';
import { DatabaseError } from '../../shared/errors';
import { DatabaseService } from '../database/tag';
import { PaperPortfolioService } from './tag';

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Persistent price sim: random walk that advances with time, not per-call. */
const _priceState = new Map<string, { price: number; ts: number }>();

function _simulatePrice(key: string, entryPrice: number): number {
  const now = Date.now();
  const state = _priceState.get(key);
  if (state) {
    const elapsed = now - state.ts;
    const steps = Math.floor(elapsed / 5000);
    if (steps > 0) {
      let price = state.price;
      for (let i = 0; i < Math.min(steps, 20); i++) {
        const step = (Math.random() - 0.5) * 0.006;
        price *= 1 + step;
      }
      price = Math.max(entryPrice * 0.7, Math.min(entryPrice * 1.3, price));
      _priceState.set(key, { price, ts: now });
      return price;
    }
    return state.price;
  }
  const initial = entryPrice * (1 + (Math.random() - 0.5) * 0.002);
  _priceState.set(key, { price: initial, ts: now });
  return initial;
}

// Lazy-loaded simulator instance
interface TradingCostSimulatorLike {
  simulateWithLiquidity(
    params: unknown,
    liquidityUsd: number
  ): {
    expectedOutput: number;
    gasCostUsd: number;
    details: Array<{ type: string; percent: number; description: string }>;
  };
}

let _simulator: TradingCostSimulatorLike | null = null;

async function getSimulator(): Promise<TradingCostSimulatorLike> {
  if (!_simulator) {
    const { createRealisticTradingSimulator } = await import('../../core/trading-costs');
    _simulator = createRealisticTradingSimulator(undefined, false) as TradingCostSimulatorLike;
  }
  return _simulator;
}

function estimateLiquidity(tokenIn: string, tokenOut: string): number {
  if (tokenIn === 'USDC' || tokenOut === 'USDC') {
    return 500000 + Math.random() * 500000;
  }
  if (tokenIn === 'ETH' || tokenOut === 'ETH' || tokenIn === 'WETH' || tokenOut === 'WETH') {
    return 1000000 + Math.random() * 2000000;
  }
  return 50000 + Math.random() * 150000;
}

function toBalanceDto(row: typeof paperBalances.$inferSelect): PaperBalanceDto {
  return {
    asset: row.asset,
    amount: row.amount,
    updatedAt: row.updatedAt?.getTime() ?? Date.now(),
  };
}

function toTradeDto(row: typeof paperTrades.$inferSelect): PaperTradeDto {
  return {
    id: row.id,
    taskId: row.taskId ?? undefined,
    venue: row.venue,
    actionType: row.actionType,
    symbol: row.symbol ?? undefined,
    side: row.side ?? undefined,
    price: row.price ?? undefined,
    size: row.size ?? undefined,
    amountUsd: row.amountUsd ?? undefined,
    orderId: row.orderId,
    status: row.status,
    createdAt: row.createdAt?.getTime() ?? Date.now(),
  };
}

// ── Layer Implementation ─────────────────────────────────────────────────────

export const PaperPortfolioServiceLive = Layer.effect(
  PaperPortfolioService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    // Helper function to ensure user has USDC seeded
    const ensureSeed = (userId: number) =>
      Effect.gen(function* () {
        const existingBalances = yield* Effect.tryPromise({
          try: async () => {
            return await db.select().from(paperBalances).where(eq(paperBalances.userId, userId));
          },
          catch: (error) => new DatabaseError(error),
        });

        if (existingBalances.length === 0) {
          yield* Effect.tryPromise({
            try: async () => {
              await db.insert(paperBalances).values({
                userId,
                asset: 'USDC',
                amount: STARTING_USDC,
              });
            },
            catch: (error) => new DatabaseError(error),
          });
        }
      });

    return PaperPortfolioService.of({
      getBalance: (userId: number, asset: string) =>
        Effect.gen(function* () {
          yield* ensureSeed(userId);

          const [row] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select()
                .from(paperBalances)
                .where(and(eq(paperBalances.userId, userId), eq(paperBalances.asset, asset)))
                .limit(1);
            },
            catch: (error) => new DatabaseError(error),
          });

          return row?.amount ?? 0;
        }),

      getBalances: (userId: number) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await db
              .select()
              .from(paperBalances)
              .where(eq(paperBalances.userId, userId))
              .orderBy(paperBalances.asset);
            return rows.map(toBalanceDto);
          },
          catch: (error) => new DatabaseError(error),
        }),

      adjustBalance: (userId: number, asset: string, delta: number) =>
        Effect.gen(function* () {
          yield* ensureSeed(userId);

          const [existing] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select()
                .from(paperBalances)
                .where(and(eq(paperBalances.userId, userId), eq(paperBalances.asset, asset)))
                .limit(1);
            },
            catch: (error) => new DatabaseError(error),
          });

          if (existing) {
            yield* Effect.tryPromise({
              try: async () => {
                await db
                  .update(paperBalances)
                  .set({
                    amount: existing.amount + delta,
                    updatedAt: new Date(),
                  })
                  .where(and(eq(paperBalances.userId, userId), eq(paperBalances.asset, asset)));
              },
              catch: (error) => new DatabaseError(error),
            });
          } else {
            yield* Effect.tryPromise({
              try: async () => {
                await db.insert(paperBalances).values({
                  userId,
                  asset,
                  amount: delta,
                });
              },
              catch: (error) => new DatabaseError(error),
            });
          }
        }),

      recordTrade: (userId: number, input: PaperTradeInput) =>
        Effect.gen(function* () {
          const orderId = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

          yield* Effect.tryPromise({
            try: async () => {
              await db.insert(paperTrades).values({
                userId,
                taskId: input.taskId,
                venue: input.venue,
                actionType: input.actionType,
                symbol: input.symbol,
                side: input.side,
                price: input.price,
                size: input.size,
                amountUsd: input.amountUsd,
                orderId,
                status: 'FILLED',
              });
            },
            catch: (error) => new DatabaseError(error),
          });

          return orderId;
        }),

      getTrades: (userId: number, opts?: { venue?: string; limit?: number }) =>
        Effect.tryPromise({
          try: async () => {
            const limit = opts?.limit ?? 50;

            if (opts?.venue) {
              const rows = await db
                .select()
                .from(paperTrades)
                .where(and(eq(paperTrades.userId, userId), eq(paperTrades.venue, opts.venue)))
                .orderBy(sql`${paperTrades.createdAt} DESC`)
                .limit(limit);
              return rows.map(toTradeDto);
            }

            const rows = await db
              .select()
              .from(paperTrades)
              .where(eq(paperTrades.userId, userId))
              .orderBy(sql`${paperTrades.createdAt} DESC`)
              .limit(limit);
            return rows.map(toTradeDto);
          },
          catch: (error) => new DatabaseError(error),
        }),

      getSummary: (userId: number) =>
        Effect.gen(function* () {
          yield* ensureSeed(userId);

          const balances = yield* Effect.tryPromise({
            try: async () => {
              const rows = await db.select().from(paperBalances).where(eq(paperBalances.userId, userId));
              return rows.map(toBalanceDto);
            },
            catch: (error) => new DatabaseError(error),
          });

          const totalUsd = balances.reduce((sum, b) => {
            if (b.asset === 'USDC' || b.asset === 'USDT' || b.asset === 'DAI') return sum + b.amount;
            return sum;
          }, 0);

          const [result] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select({ count: sql<number>`count(*)` })
                .from(paperTrades)
                .where(eq(paperTrades.userId, userId));
            },
            catch: (error) => new DatabaseError(error),
          });

          const recentTrades = yield* Effect.tryPromise({
            try: async () => {
              const rows = await db
                .select()
                .from(paperTrades)
                .where(eq(paperTrades.userId, userId))
                .orderBy(sql`${paperTrades.createdAt} DESC`)
                .limit(10);
              return rows.map(toTradeDto);
            },
            catch: (error) => new DatabaseError(error),
          });

          return {
            balances,
            totalUsd,
            tradeCount: result?.count ?? 0,
            recentTrades,
          };
        }),

      resetPortfolio: (userId: number, startingUsdc?: number) =>
        Effect.tryPromise({
          try: async () => {
            await db.delete(paperTrades).where(eq(paperTrades.userId, userId));
            await db.delete(paperBalances).where(eq(paperBalances.userId, userId));
            await db.insert(paperBalances).values({
              userId,
              asset: 'USDC',
              amount: startingUsdc ?? STARTING_USDC,
            });
          },
          catch: (error) => new DatabaseError(error),
        }),

      getPositions: (userId: number, venue?: string) =>
        Effect.tryPromise({
          try: async () => {
            let rows: (typeof paperTrades.$inferSelect)[];

            if (venue) {
              rows = await db
                .select()
                .from(paperTrades)
                .where(and(eq(paperTrades.userId, userId), eq(paperTrades.venue, venue)))
                .orderBy(paperTrades.createdAt);
            } else {
              rows = await db
                .select()
                .from(paperTrades)
                .where(eq(paperTrades.userId, userId))
                .orderBy(paperTrades.createdAt);
            }

            const map = new Map<string, { shares: number; cost: number; side: string; venue: string }>();
            for (const t of rows) {
              if (!t.symbol) continue;
              const key = `${t.venue}:${t.symbol}`;
              const entry = map.get(key) ?? { shares: 0, cost: 0, side: t.side ?? 'buy', venue: t.venue };

              const units = t.size ?? t.amountUsd ?? 0;
              if (t.actionType.includes('close') || t.side === 'sell') {
                entry.shares -= units;
                entry.cost -= t.amountUsd ?? 0;
              } else {
                entry.shares += units;
                entry.cost += t.amountUsd ?? 0;
              }
              map.set(key, entry);
            }

            const positions: PaperPosition[] = [];
            for (const [key, v] of map) {
              if (v.shares > 0.001) {
                const symbol = key.split(':')[1] ?? key;
                const avgPrice = v.cost / v.shares;
                const currentPrice = _simulatePrice(key, avgPrice);
                const pnlUsd = (currentPrice - avgPrice) * v.shares;
                positions.push({
                  symbol,
                  venue: v.venue,
                  side: v.side,
                  totalShares: v.shares,
                  avgPrice,
                  totalCost: v.cost,
                  currentPrice,
                  pnlUsd,
                });
              }
            }
            return positions;
          },
          catch: (error) => new DatabaseError(error),
        }),

      simulateSwap: (params: SwapSimulationParams) =>
        Effect.tryPromise({
          try: async () => {
            const { tokenIn, tokenOut, amountIn, chainId = 'base' } = params;
            const { CHAIN_CONFIGS, createTokenProfile } = await import('../../core/trading-costs');

            const chainMap: Record<string, string> = {
              base: 'BASE',
              ethereum: 'ETHEREUM',
              solana: 'SOLANA',
            };
            const chain = CHAIN_CONFIGS[chainMap[chainId] ?? 'BASE'];

            const tokenInProfile = createTokenProfile(tokenIn, tokenIn);
            const tokenOutProfile = createTokenProfile(tokenOut, tokenOut);

            const tradeParams = {
              amountIn,
              tokenIn: tokenInProfile,
              tokenOut: tokenOutProfile,
              chain,
              urgency: 'medium' as const,
            };

            const simulator = await getSimulator();
            const costs = simulator.simulateWithLiquidity(
              tradeParams,
              params.liquidityUsd ?? tokenOutProfile.typicalLiquidityUsd
            );

            const executionDelayMs = 10000 + Math.random() * 20000;

            const dexFeeDetail = costs.details.find((d: { type: string }) => d.type === 'dex_fee');
            const slippageDetail = costs.details.find((d: { type: string }) => d.type === 'slippage');
            const impactDetail = costs.details.find((d: { type: string }) => d.type === 'price_impact');

            return {
              amountOut: costs.expectedOutput,
              slippagePercent: slippageDetail?.percent ?? 0.5,
              priceImpactPercent: impactDetail?.percent ?? 0.5,
              dexFeePercent: dexFeeDetail?.percent ?? 0.3,
              gasCostUsd: costs.gasCostUsd,
              executionDelayMs,
              effectivePrice: amountIn / costs.expectedOutput,
              details: costs.details.map((d: { description: string }) => d.description).join(' | '),
            };
          },
          catch: (error) => new DatabaseError(error),
        }),

      recordSwap: (
        userId: number,
        taskId: string,
        tokenIn: string,
        tokenOut: string,
        amountIn: number,
        chainId?: 'base' | 'ethereum' | 'solana'
      ) =>
        Effect.gen(function* () {
          const liquidityUsd = estimateLiquidity(tokenIn, tokenOut);

          const simulation: SwapSimulationResult = yield* Effect.tryPromise({
            try: async () => {
              const { CHAIN_CONFIGS, createTokenProfile } = await import('../../core/trading-costs');

              const chainMap: Record<string, string> = {
                base: 'BASE',
                ethereum: 'ETHEREUM',
                solana: 'SOLANA',
              };
              const chain = CHAIN_CONFIGS[chainMap[chainId ?? 'base'] ?? 'BASE'];

              const tokenInProfile = createTokenProfile(tokenIn, tokenIn);
              const tokenOutProfile = createTokenProfile(tokenOut, tokenOut);

              const tradeParams = {
                amountIn,
                tokenIn: tokenInProfile,
                tokenOut: tokenOutProfile,
                chain,
                urgency: 'medium' as const,
              };

              const simulator = await getSimulator();
              const costs = simulator.simulateWithLiquidity(tradeParams, liquidityUsd);

              const executionDelayMs = 10000 + Math.random() * 20000;

              const dexFeeDetail = costs.details.find((d: { type: string }) => d.type === 'dex_fee');
              const slippageDetail = costs.details.find((d: { type: string }) => d.type === 'slippage');
              const impactDetail = costs.details.find((d: { type: string }) => d.type === 'price_impact');

              return {
                amountOut: costs.expectedOutput,
                slippagePercent: slippageDetail?.percent ?? 0.5,
                priceImpactPercent: impactDetail?.percent ?? 0.5,
                dexFeePercent: dexFeeDetail?.percent ?? 0.3,
                gasCostUsd: costs.gasCostUsd,
                executionDelayMs,
                effectivePrice: amountIn / costs.expectedOutput,
                details: costs.details.map((d: { description: string }) => d.description).join(' | '),
              };
            },
            catch: (error) => new DatabaseError(error),
          });

          // Perform balance adjustments directly
          yield* ensureSeed(userId);

          // Get current balances
          const [balanceIn] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select()
                .from(paperBalances)
                .where(and(eq(paperBalances.userId, userId), eq(paperBalances.asset, tokenIn)))
                .limit(1);
            },
            catch: (error) => new DatabaseError(error),
          });

          const [balanceOut] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select()
                .from(paperBalances)
                .where(and(eq(paperBalances.userId, userId), eq(paperBalances.asset, tokenOut)))
                .limit(1);
            },
            catch: (error) => new DatabaseError(error),
          });

          // Update tokenIn balance (subtract)
          if (balanceIn) {
            yield* Effect.tryPromise({
              try: async () => {
                await db
                  .update(paperBalances)
                  .set({
                    amount: balanceIn.amount - amountIn,
                    updatedAt: new Date(),
                  })
                  .where(and(eq(paperBalances.userId, userId), eq(paperBalances.asset, tokenIn)));
              },
              catch: (error) => new DatabaseError(error),
            });
          }

          // Update tokenOut balance (add)
          if (balanceOut) {
            yield* Effect.tryPromise({
              try: async () => {
                await db
                  .update(paperBalances)
                  .set({
                    amount: balanceOut.amount + simulation.amountOut,
                    updatedAt: new Date(),
                  })
                  .where(and(eq(paperBalances.userId, userId), eq(paperBalances.asset, tokenOut)));
              },
              catch: (error) => new DatabaseError(error),
            });
          } else {
            yield* Effect.tryPromise({
              try: async () => {
                await db.insert(paperBalances).values({
                  userId,
                  asset: tokenOut,
                  amount: simulation.amountOut,
                });
              },
              catch: (error) => new DatabaseError(error),
            });
          }

          // Record the trade
          const orderId = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          yield* Effect.tryPromise({
            try: async () => {
              await db.insert(paperTrades).values({
                userId,
                taskId,
                venue: `chain:${chainId || 'base'}`,
                actionType: 'chain_swap_realistic',
                symbol: `${tokenIn}->${tokenOut}`,
                side: 'buy',
                price: simulation.effectivePrice,
                size: simulation.amountOut,
                amountUsd: amountIn - simulation.gasCostUsd,
                orderId,
                status: 'FILLED',
              });
            },
            catch: (error) => new DatabaseError(error),
          });

          return { ...simulation, orderId };
        }),
    });
  })
);

// Layer para testing
export const PaperPortfolioServiceTest = Layer.succeed(
  PaperPortfolioService,
  PaperPortfolioService.of({
    getBalance: () => Effect.succeed(10000),
    getBalances: () => Effect.succeed([{ asset: 'USDC', amount: 10000, updatedAt: Date.now() }]),
    adjustBalance: () => Effect.succeed(undefined),
    recordTrade: () => Effect.succeed('paper-test-123'),
    getTrades: () => Effect.succeed([]),
    getSummary: () =>
      Effect.succeed({
        balances: [{ asset: 'USDC', amount: 10000, updatedAt: Date.now() }],
        totalUsd: 10000,
        tradeCount: 0,
        recentTrades: [],
      }),
    resetPortfolio: () => Effect.succeed(undefined),
    getPositions: () => Effect.succeed([]),
    simulateSwap: () =>
      Effect.succeed({
        amountOut: 100,
        slippagePercent: 0.5,
        priceImpactPercent: 0.5,
        dexFeePercent: 0.3,
        gasCostUsd: 0.5,
        executionDelayMs: 15000,
        effectivePrice: 1,
        details: 'Test simulation',
      }),
    recordSwap: () =>
      Effect.succeed({
        amountOut: 100,
        slippagePercent: 0.5,
        priceImpactPercent: 0.5,
        dexFeePercent: 0.3,
        gasCostUsd: 0.5,
        executionDelayMs: 15000,
        effectivePrice: 1,
        details: 'Test simulation',
        orderId: 'paper-test-123',
      }),
  })
);

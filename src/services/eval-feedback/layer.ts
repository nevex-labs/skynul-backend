import { type SQL, and, desc, eq, gte, sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import {
  type ExtractedTradeDto,
  type GetPerformanceSummaryOpts,
  type PerformanceSummaryDto,
  type ScoreInputDto,
  type TradeScoreDto,
  type TradeVenue,
  tradeScores,
} from '../../infrastructure/db/schema/eval-feedback';
import { DatabaseError } from '../../shared/errors';
import type { Task } from '../../types';
import { DatabaseService } from '../database/tag';
import { EvalFeedbackService } from './tag';

// ── Internal helpers ──────────────────────────────────────────────────────────

const TRADING_CAPS = new Set<string>(['polymarket.trading', 'cex.trading', 'onchain.trading']);

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function capToVenue(cap: string, task: Task): TradeVenue | null {
  if (cap === 'polymarket.trading') return 'polymarket';
  if (cap === 'onchain.trading') return 'onchain';
  if (cap === 'cex.trading') {
    // Check if any cex_place_order step references binance or coinbase
    const cexStep = task.steps.find((s) => s.action.type === 'cex_place_order');
    const exchange = cexStep ? (cexStep.action as any).exchange : 'binance';
    return exchange === 'coinbase' ? 'cex_coinbase' : 'cex_binance';
  }
  return null;
}

function extractTradesFromTaskInternal(task: Task): {
  venue: TradeVenue;
  capability: string;
  trades: ExtractedTradeDto[];
  hadOpenPositionsAtDone: boolean;
} | null {
  const tradingCap = task.capabilities.find((c) => TRADING_CAPS.has(c));
  if (!tradingCap) return null;

  const venue = capToVenue(tradingCap, task);
  if (!venue) return null;

  const trades: ExtractedTradeDto[] = [];
  let hadOpenPositionsAtDone = false;
  let lastAccountSummaryBeforeDone: string | null = null;

  // Scan steps forward; track last account summary before done action
  for (const step of task.steps) {
    const a = step.action;

    if (a.type === 'polymarket_place_order') {
      trades.push({
        symbol: (a as any).tokenId.slice(0, 16),
        side: (a as any).side,
        entryPrice: (a as any).price,
        exitPrice: null,
        size: (a as any).size,
        pnlUsd: 0,
      });
    } else if (a.type === 'polymarket_get_account_summary' && step.result) {
      lastAccountSummaryBeforeDone = step.result;
    } else if (a.type === 'cex_place_order') {
      // Parse size from result: "Order placed on binance: buy 99.6 BTCUSDT | ..."
      const sizeMatch = step.result?.match(/:\s*(buy|sell)\s+([\d.]+)\s+(\S+)/);
      const parsedSide = (a as any).side;
      const parsedSize = sizeMatch ? Number.parseFloat(sizeMatch[2]) : (a as any).amount;
      trades.push({
        symbol: (a as any).symbol,
        side: parsedSide,
        entryPrice: (a as any).price ?? 0,
        exitPrice: null,
        size: parsedSize,
        pnlUsd: 0,
      });
    } else if (a.type === 'chain_swap') {
      trades.push({
        symbol: `${(a as any).tokenIn}→${(a as any).tokenOut}`,
        side: 'buy',
        entryPrice: 0,
        exitPrice: null,
        size: Number.parseFloat((a as any).amountIn) || 0,
        pnlUsd: 0,
      });
    } else if (a.type === 'done' || a.type === 'fail') {
      break; // stop tracking after task ends
    }
  }

  if (trades.length === 0) return null;

  // Check if positions were open at done
  if (lastAccountSummaryBeforeDone) {
    const posMatch = lastAccountSummaryBeforeDone.match(/(\d+)\s+positions?\./i);
    if (posMatch && Number.parseInt(posMatch[1], 10) > 0) {
      hadOpenPositionsAtDone = true;
    }
  }

  return { venue, capability: tradingCap, trades, hadOpenPositionsAtDone };
}

function computeScoreInternal(input: ScoreInputDto): {
  scorePnl: number;
  scoreDiscipline: number;
  scoreEfficiency: number;
  scoreTotal: number;
  totalPnlUsd: number;
  pnlPct: number;
} {
  const { trades, hadOpenPositionsAtDone = false, stepsUsed, taskStatus, taskSteps, taskMaxSteps } = input;

  // Aggregate PnL
  const totalPnlUsd = trades.reduce((sum, t) => sum + t.pnlUsd, 0);
  const totalInvested = trades.reduce((sum, t) => sum + t.entryPrice * t.size, 0);
  const pnlPct = totalInvested > 0 ? (totalPnlUsd / totalInvested) * 100 : 0;

  // scorePnl (weight 0.40)
  let scorePnl: number;
  if (totalPnlUsd > 0) {
    scorePnl = clamp(0.5 + pnlPct / 20, 0, 1.0);
  } else if (totalPnlUsd === 0) {
    scorePnl = 0.3;
  } else {
    scorePnl = clamp(0.3 - Math.abs(pnlPct) / 30, 0, 1.0);
  }

  // scoreDiscipline (weight 0.35)
  let scoreDiscipline = 1.0;
  if (hadOpenPositionsAtDone) scoreDiscipline -= 0.4;
  if (taskStatus === 'failed') scoreDiscipline -= 0.2;
  if (taskStatus === 'cancelled') scoreDiscipline -= 0.1;
  scoreDiscipline = clamp(scoreDiscipline, 0, 1.0);

  // scoreEfficiency (weight 0.25)
  const effectiveSteps = stepsUsed ?? taskSteps.length;
  const stepRatio = taskMaxSteps > 0 ? effectiveSteps / taskMaxSteps : 1;
  let scoreEfficiency: number;
  if (taskStatus === 'completed') {
    scoreEfficiency = clamp(1.0 - stepRatio * 0.5, 0, 1.0);
  } else {
    scoreEfficiency = clamp(0.3 - stepRatio, 0, 1.0);
  }

  const scoreTotal = clamp(scorePnl * 0.4 + scoreDiscipline * 0.35 + scoreEfficiency * 0.25, 0, 1.0);

  return { scorePnl, scoreDiscipline, scoreEfficiency, scoreTotal, totalPnlUsd, pnlPct };
}

function toTradeScoreDto(row: typeof tradeScores.$inferSelect): TradeScoreDto {
  return {
    id: row.id,
    taskId: row.taskId,
    venue: row.venue as TradeVenue,
    capability: row.capability,
    symbol: row.symbol ?? null,
    side: row.side ?? null,
    entryPrice: row.entryPrice ?? null,
    exitPrice: row.exitPrice ?? null,
    size: row.size ?? null,
    pnlUsd: row.pnlUsd,
    pnlPct: row.pnlPct,
    scorePnl: row.scorePnl,
    scoreDiscipline: row.scoreDiscipline,
    scoreEfficiency: row.scoreEfficiency,
    scoreTotal: row.scoreTotal,
    stepsUsed: row.stepsUsed,
    maxSteps: row.maxSteps,
    durationMs: row.durationMs,
    hadOpenPositionsAtDone: row.hadOpenPositionsAtDone,
    isPaper: row.isPaper,
    createdAt: row.createdAt?.getTime() ?? Date.now(),
  };
}

const ZEROED_SUMMARY: PerformanceSummaryDto = {
  totalTasks: 0,
  winRate: 0,
  totalPnlUsd: 0,
  avgScoreTotal: 0,
  avgScoreDiscipline: 0,
  avgScoreEfficiency: 0,
  recentTasks: [],
  byVenue: {},
};

function formatPerformanceForPrompt(summary: PerformanceSummaryDto): string {
  if (summary.totalTasks === 0) return '';

  const winPct = Math.round(summary.winRate * 100);
  const pnlSign = summary.totalPnlUsd >= 0 ? '+' : '';
  const disciplineWarning =
    summary.avgScoreDiscipline < 0.7
      ? '\n- ⚠️  WARNING: You often leave positions open before calling done. ALWAYS close all positions first.'
      : '';

  const recentLines = summary.recentTasks
    .slice(0, 3)
    .map((t) => {
      const pnl = t.pnlUsd >= 0 ? `+$${t.pnlUsd.toFixed(2)}` : `-$${Math.abs(t.pnlUsd).toFixed(2)}`;
      return `  ${pnl} (${t.venue}, score: ${t.scoreTotal.toFixed(2)})`;
    })
    .join('\n');

  return `\n## TRADING PERFORMANCE (your track record — use this to improve):\n- Win rate: ${winPct}% (${summary.totalTasks} trades total)\n- Total PnL: ${pnlSign}$${summary.totalPnlUsd.toFixed(2)}\n- Avg score: ${summary.avgScoreTotal.toFixed(2)}/1.00 (discipline: ${summary.avgScoreDiscipline.toFixed(2)}, efficiency: ${summary.avgScoreEfficiency.toFixed(2)})${disciplineWarning}\n${recentLines ? `- Recent:\n${recentLines}` : ''}\n`;
}

// ── Layer Implementation ─────────────────────────────────────────────────────

export const EvalFeedbackServiceLive = Layer.effect(
  EvalFeedbackService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    // Helper to build where clause for performance queries
    const buildWhereClause = (opts: GetPerformanceSummaryOpts): SQL<unknown> => {
      let whereClause = eq(tradeScores.userId, opts.userId) as SQL<unknown>;

      if (opts.days && opts.days > 0) {
        const cutoff = new Date(Date.now() - opts.days * 86_400_000);
        whereClause = and(whereClause, gte(tradeScores.createdAt, cutoff))!;
      }
      if (opts.venue) {
        whereClause = and(whereClause, eq(tradeScores.venue, opts.venue))!;
      }
      if (opts.paperOnly === true) {
        whereClause = and(whereClause, eq(tradeScores.isPaper, true))!;
      } else if (opts.paperOnly === false) {
        whereClause = and(whereClause, eq(tradeScores.isPaper, false))!;
      }

      return whereClause;
    };

    // Internal implementation of getPerformanceSummary for reuse
    const getPerformanceSummaryImpl = (opts: GetPerformanceSummaryOpts) =>
      Effect.gen(function* () {
        const whereClause = buildWhereClause(opts);

        const agg = yield* Effect.tryPromise({
          try: async () => {
            const result = await db
              .select({
                total: sql<number>`count(*)`,
                avgTotal: sql<number>`avg(${tradeScores.scoreTotal})`,
                avgDisc: sql<number>`avg(${tradeScores.scoreDiscipline})`,
                avgEff: sql<number>`avg(${tradeScores.scoreEfficiency})`,
                sumPnl: sql<number>`sum(${tradeScores.pnlUsd})`,
                winRate: sql<number>`sum(case when ${tradeScores.pnlUsd} > 0 then 1 else 0 end)::float / nullif(count(*), 0)`,
              })
              .from(tradeScores)
              .where(whereClause);
            return result[0];
          },
          catch: (error) => new DatabaseError(error),
        });

        const total = agg?.total ?? 0;
        if (total === 0) return { ...ZEROED_SUMMARY };

        const limit = opts.limit ?? 5;
        const recent = yield* Effect.tryPromise({
          try: async () => {
            const rows = await db
              .select()
              .from(tradeScores)
              .where(whereClause)
              .orderBy(desc(tradeScores.createdAt))
              .limit(limit);
            return rows.map(toTradeScoreDto);
          },
          catch: (error) => new DatabaseError(error),
        });

        // by venue breakdown
        const venueRows = yield* Effect.tryPromise({
          try: async () => {
            return await db
              .select({
                venue: tradeScores.venue,
                cnt: sql<number>`count(*)`,
                pnl: sql<number>`sum(${tradeScores.pnlUsd})`,
                avgS: sql<number>`avg(${tradeScores.scoreTotal})`,
              })
              .from(tradeScores)
              .where(whereClause)
              .groupBy(tradeScores.venue);
          },
          catch: (error) => new DatabaseError(error),
        });

        const byVenue: PerformanceSummaryDto['byVenue'] = {};
        for (const v of venueRows) {
          byVenue[v.venue as TradeVenue] = {
            count: v.cnt,
            pnlUsd: v.pnl ?? 0,
            avgScore: v.avgS ?? 0,
          };
        }

        return {
          totalTasks: total,
          winRate: agg?.winRate ?? 0,
          totalPnlUsd: agg?.sumPnl ?? 0,
          avgScoreTotal: agg?.avgTotal ?? 0,
          avgScoreDiscipline: agg?.avgDisc ?? 0,
          avgScoreEfficiency: agg?.avgEff ?? 0,
          recentTasks: recent,
          byVenue,
        };
      });

    return EvalFeedbackService.of({
      saveTradeScore: (input: ScoreInputDto) =>
        Effect.gen(function* () {
          const scores = computeScoreInternal(input);
          const firstTrade = input.trades[0] ?? null;

          const result = yield* Effect.tryPromise({
            try: async () => {
              const rows = await db
                .insert(tradeScores)
                .values({
                  userId: input.userId,
                  taskId: input.taskId,
                  venue: input.venue,
                  capability: input.capability,
                  symbol: firstTrade?.symbol ?? null,
                  side: firstTrade?.side ?? null,
                  entryPrice: firstTrade?.entryPrice ?? null,
                  exitPrice: firstTrade?.exitPrice ?? null,
                  size: firstTrade?.size ?? null,
                  pnlUsd: scores.totalPnlUsd,
                  pnlPct: scores.pnlPct,
                  scorePnl: scores.scorePnl,
                  scoreDiscipline: scores.scoreDiscipline,
                  scoreEfficiency: scores.scoreEfficiency,
                  scoreTotal: scores.scoreTotal,
                  stepsUsed: input.stepsUsed ?? input.taskSteps.length,
                  maxSteps: input.taskMaxSteps,
                  durationMs: input.durationMs,
                  hadOpenPositionsAtDone: input.hadOpenPositionsAtDone ?? false,
                  isPaper: input.isPaper ?? false,
                  createdAt: new Date(),
                })
                .returning({ id: tradeScores.id });
              return rows[0]?.id ?? -1;
            },
            catch: (error) => new DatabaseError(error),
          });

          return result;
        }),

      getTaskScore: (userId: number, taskId: string) =>
        Effect.tryPromise({
          try: async () => {
            const [row] = await db
              .select()
              .from(tradeScores)
              .where(and(eq(tradeScores.userId, userId), eq(tradeScores.taskId, taskId)))
              .limit(1);
            return row ? toTradeScoreDto(row) : null;
          },
          catch: (error) => new DatabaseError(error),
        }),

      getPerformanceSummary: getPerformanceSummaryImpl,

      formatPerformanceForPrompt: (summary: PerformanceSummaryDto): string => {
        return formatPerformanceForPrompt(summary);
      },

      buildFeedbackContext: (userId: number, capabilities: string[]) =>
        Effect.gen(function* () {
          const TRADING_CAP_SET = new Set(['polymarket.trading', 'cex.trading', 'onchain.trading']);
          const hasTradingCap = capabilities.some((c) => TRADING_CAP_SET.has(c));
          if (!hasTradingCap) return '';

          // Use the internal implementation directly
          const summary = yield* getPerformanceSummaryImpl({ userId, days: 30, limit: 3 });

          if (summary.totalTasks === 0) return '';
          return formatPerformanceForPrompt(summary);
        }),

      extractTradesFromTask: (task: Task) =>
        Effect.sync(() => {
          return extractTradesFromTaskInternal(task);
        }),

      computeScore: (input: ScoreInputDto) =>
        Effect.sync(() => {
          return computeScoreInternal(input);
        }),
    });
  })
);

// Layer para testing
export const EvalFeedbackServiceTest = Layer.succeed(
  EvalFeedbackService,
  EvalFeedbackService.of({
    saveTradeScore: () => Effect.succeed(1),
    getTaskScore: () => Effect.succeed(null),
    getPerformanceSummary: () =>
      Effect.succeed({
        totalTasks: 0,
        winRate: 0,
        totalPnlUsd: 0,
        avgScoreTotal: 0,
        avgScoreDiscipline: 0,
        avgScoreEfficiency: 0,
        recentTasks: [],
        byVenue: {},
      }),
    formatPerformanceForPrompt: () => '',
    buildFeedbackContext: () => Effect.succeed(''),
    extractTradesFromTask: () => Effect.succeed(null),
    computeScore: () =>
      Effect.succeed({
        scorePnl: 0.5,
        scoreDiscipline: 0.8,
        scoreEfficiency: 0.7,
        scoreTotal: 0.65,
        totalPnlUsd: 0,
        pnlPct: 0,
      }),
  })
);

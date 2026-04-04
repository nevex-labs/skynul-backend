import { boolean, integer, pgTable, real, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Evaluation & Feedback - Trade scoring and performance tracking
 * Stores trade scores, evaluation records, and performance metrics
 */

export const tradeScores = pgTable('trade_scores', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  taskId: varchar('task_id', { length: 255 }).notNull(),
  venue: varchar('venue', { length: 50 }).notNull(),
  capability: varchar('capability', { length: 100 }).notNull(),
  symbol: varchar('symbol', { length: 50 }),
  side: varchar('side', { length: 10 }),
  entryPrice: real('entry_price'),
  exitPrice: real('exit_price'),
  size: real('size'),
  pnlUsd: real('pnl_usd').notNull().default(0),
  pnlPct: real('pnl_pct').notNull().default(0),
  scorePnl: real('score_pnl').notNull().default(0),
  scoreDiscipline: real('score_discipline').notNull().default(0),
  scoreEfficiency: real('score_efficiency').notNull().default(0),
  scoreTotal: real('score_total').notNull().default(0),
  stepsUsed: integer('steps_used').notNull().default(0),
  maxSteps: integer('max_steps').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  hadOpenPositionsAtDone: boolean('had_open_positions_at_done').notNull().default(false),
  isPaper: boolean('is_paper').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type TradeScore = typeof tradeScores.$inferSelect;
export type NewTradeScore = typeof tradeScores.$inferInsert;

// ── DTOs for service interface ────────────────────────────────────────────────

export type TradeScoreDto = {
  id: number;
  taskId: string;
  venue: TradeVenue;
  capability: string;
  symbol: string | null;
  side: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  size: number | null;
  pnlUsd: number;
  pnlPct: number;
  scorePnl: number;
  scoreDiscipline: number;
  scoreEfficiency: number;
  scoreTotal: number;
  stepsUsed: number;
  maxSteps: number;
  durationMs: number;
  hadOpenPositionsAtDone: boolean;
  isPaper: boolean;
  createdAt: number;
};

export type ExtractedTradeDto = {
  symbol: string;
  side: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number | null;
  size: number;
  pnlUsd: number;
};

export type ScoreInputDto = {
  userId: number;
  taskId: string;
  taskStatus: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  taskSteps: { action: { type: string }; result?: string }[];
  taskMaxSteps: number;
  venue: TradeVenue;
  capability: string;
  trades: ExtractedTradeDto[];
  durationMs: number;
  isPaper?: boolean;
  hadOpenPositionsAtDone?: boolean;
  stepsUsed?: number;
};

export type PerformanceSummaryDto = {
  totalTasks: number;
  winRate: number;
  totalPnlUsd: number;
  avgScoreTotal: number;
  avgScoreDiscipline: number;
  avgScoreEfficiency: number;
  recentTasks: TradeScoreDto[];
  byVenue: Partial<Record<TradeVenue, { count: number; pnlUsd: number; avgScore: number }>>;
};

// ── Enums/Types ───────────────────────────────────────────────────────────────

export type TradeVenue = 'polymarket' | 'cex_binance' | 'cex_coinbase' | 'onchain';

export type GetPerformanceSummaryOpts = {
  userId: number;
  days?: number;
  venue?: TradeVenue;
  paperOnly?: boolean;
  limit?: number;
};

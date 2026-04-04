import { integer, pgTable, primaryKey, real, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Risk Guard - Trade guardrails and limits per user.
 * Each user has their own isolated risk limits and position tracking.
 */

// Daily volume tracking per venue
export const riskDailyVolume = pgTable(
  'risk_daily_volume',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: varchar('date', { length: 10 }).notNull(), // YYYY-MM-DD format
    venue: varchar('venue', { length: 50 }).notNull(),
    volumeUsd: real('volume_usd').notNull().default(0),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.date, table.venue] }),
  })
);

// Open positions tracking
export const riskPositions = pgTable('risk_positions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  venue: varchar('venue', { length: 50 }).notNull(),
  symbol: varchar('symbol', { length: 50 }).notNull(),
  side: varchar('side', { length: 10 }).notNull(),
  sizeUsd: real('size_usd').notNull(),
  taskId: varchar('task_id', { length: 255 }),
  openedAt: timestamp('opened_at').defaultNow(),
  closedAt: timestamp('closed_at'),
  mode: varchar('mode', { length: 20 }).notNull().default('task'), // 'task' or 'yolo'
  entryPrice: real('entry_price'),
  exitPrice: real('exit_price'),
  pnlUsd: real('pnl_usd'),
});

// YOLO mode trades
export const yoloTrades = pgTable('yolo_trades', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 50 }).notNull(),
  chain: varchar('chain', { length: 50 }).notNull(),
  side: varchar('side', { length: 10 }).notNull(),
  sizeUsd: real('size_usd').notNull(),
  entryPrice: real('entry_price').notNull(),
  exitPrice: real('exit_price'),
  pnlUsd: real('pnl_usd'),
  openedAt: timestamp('opened_at').defaultNow(),
  closedAt: timestamp('closed_at'),
  exitReason: varchar('exit_reason', { length: 50 }), // 'take_profit', 'stop_loss', 'time_limit', 'rug_pull', 'manual'
  taskId: varchar('task_id', { length: 255 }),
});

export type RiskDailyVolume = typeof riskDailyVolume.$inferSelect;
export type NewRiskDailyVolume = typeof riskDailyVolume.$inferInsert;
export type RiskPosition = typeof riskPositions.$inferSelect;
export type NewRiskPosition = typeof riskPositions.$inferInsert;
export type YoloTrade = typeof yoloTrades.$inferSelect;
export type NewYoloTrade = typeof yoloTrades.$inferInsert;

// DTOs for service layer
export type RiskPositionDto = {
  id: number;
  venue: string;
  symbol: string;
  side: string;
  sizeUsd: number;
  taskId: string | null;
  openedAt: number;
  closedAt: number | null;
  mode: 'task' | 'yolo';
  entryPrice?: number;
  exitPrice?: number;
  pnlUsd?: number;
};

export type YoloCheckResult = { allowed: true } | { allowed: false; reason: string; suggestedFix?: string };

export type ExitTrigger =
  | { type: 'take_profit'; profitPercent: number; profitUsd: number }
  | { type: 'stop_loss'; lossPercent: number; lossUsd: number }
  | { type: 'time_limit'; holdTimeSeconds: number }
  | { type: 'rug_pull'; reason: string }
  | { type: 'manual' };

export type TradingMode = 'task' | 'yolo';

// Venue IDs
export type VenueId = 'polymarket' | 'chain' | 'binance' | 'coinbase';

// Risk limits configuration
export type RiskLimits = {
  /** Max USD value for a single trade. Default: 500 */
  maxSingleTradeUsd: number;
  /** Max total USD traded across all venues today. Default: 5000 */
  maxDailyVolumeUsd: number;
  /** Max open (unclosed) positions at once per venue. Default: 5 */
  maxConcurrentPositions: number;
  /** Global kill switch — false bypasses all checks. Default: true */
  enabled: boolean;

  // YOLO Mode specific limits
  /** Max daily loss before stopping (USD). Default: 100 */
  maxDailyLossUsd?: number;
  /** Minimum liquidity required for token (USD). Default: 50000 */
  minLiquidityUsd?: number;
  /** Max time to hold a position (seconds). Default: 300 (5 min) */
  maxHoldTimeSeconds?: number;
  /** Take profit percentage (0.3 = 30%). Default: 0.3 */
  takeProfitPercent?: number;
  /** Stop loss percentage (0.2 = 20%). Default: 0.2 */
  stopLossPercent?: number;
  /** Cooldown between trades (seconds). Default: 60 */
  tradeCooldownSeconds?: number;
};

export type RiskConfig = {
  global: RiskLimits;
  /** Per-venue overrides merged on top of global limits. */
  venues: Partial<Record<VenueId, Partial<RiskLimits>>>;
};

export type RiskCheckResult = { allowed: true } | { allowed: false; reason: string };

// Default limits
export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxSingleTradeUsd: 500,
  maxDailyVolumeUsd: 5_000,
  maxConcurrentPositions: 5,
  enabled: true,
};

// YOLO Mode defaults (meme coin scalping)
export const DEFAULT_YOLO_RISK_LIMITS: RiskLimits = {
  maxSingleTradeUsd: 50, // Small positions
  maxDailyVolumeUsd: 500, // $500 daily max
  maxConcurrentPositions: 3, // Max 3 positions
  enabled: true,
  maxDailyLossUsd: 100, // Stop if lose $100
  minLiquidityUsd: 50_000, // Min $50k liquidity
  maxHoldTimeSeconds: 300, // 5 min max hold
  takeProfitPercent: 0.3, // 30% take profit
  stopLossPercent: 0.2, // 20% stop loss
  tradeCooldownSeconds: 60, // 1 min between trades
};

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  global: { ...DEFAULT_RISK_LIMITS },
  venues: {},
};

export const DEFAULT_MODE_CONFIG = {
  task: { ...DEFAULT_RISK_LIMITS },
  yolo: { ...DEFAULT_YOLO_RISK_LIMITS },
};

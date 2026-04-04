import { integer, pgTable, real, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Paper Portfolio - Virtual trading portfolio for paper trading mode.
 * Each user has their own isolated paper trading environment.
 */

export const paperBalances = pgTable('paper_balances', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  asset: varchar('asset', { length: 50 }).notNull(),
  amount: real('amount').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const paperTrades = pgTable('paper_trades', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  taskId: varchar('task_id', { length: 255 }),
  venue: varchar('venue', { length: 50 }).notNull(),
  actionType: varchar('action_type', { length: 100 }).notNull(),
  symbol: varchar('symbol', { length: 50 }),
  side: varchar('side', { length: 10 }),
  price: real('price'),
  size: real('size'),
  amountUsd: real('amount_usd'),
  orderId: varchar('order_id', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('FILLED'),
  createdAt: timestamp('created_at').defaultNow(),
});

export type PaperBalance = typeof paperBalances.$inferSelect;
export type NewPaperBalance = typeof paperBalances.$inferInsert;
export type PaperTrade = typeof paperTrades.$inferSelect;
export type NewPaperTrade = typeof paperTrades.$inferInsert;

export type PaperBalanceDto = {
  asset: string;
  amount: number;
  updatedAt: number;
};

export type PaperTradeDto = {
  id: number;
  taskId?: string;
  venue: string;
  actionType: string;
  symbol?: string;
  side?: string;
  price?: number;
  size?: number;
  amountUsd?: number;
  orderId: string;
  status: string;
  createdAt: number;
};

export type PaperTradeInput = {
  taskId?: string;
  venue: string;
  actionType: string;
  symbol?: string;
  side?: string;
  price?: number;
  size?: number;
  amountUsd?: number;
};

export type PaperPortfolioSummary = {
  balances: PaperBalanceDto[];
  totalUsd: number;
  tradeCount: number;
  recentTrades: PaperTradeDto[];
};

export type PaperPosition = {
  symbol: string;
  venue: string;
  side: string;
  totalShares: number;
  avgPrice: number;
  totalCost: number;
  currentPrice: number;
  pnlUsd: number;
};

export type SwapSimulationParams = {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  chainId?: 'base' | 'ethereum' | 'solana';
  liquidityUsd?: number;
};

export type SwapSimulationResult = {
  amountOut: number;
  slippagePercent: number;
  priceImpactPercent: number;
  dexFeePercent: number;
  gasCostUsd: number;
  executionDelayMs: number;
  effectivePrice: number;
  details: string;
};

export const STARTING_USDC = 10_000;

/**
 * PaperPortfolio — virtual portfolio for paper trading mode.
 *
 * Stores balances and trades in the shared memory SQLite DB.
 * Auto-seeds 10k USDC on first use.
 */

import Database from 'better-sqlite3';
import { getMemoryDb } from './task-memory';

// ── Schema ────────────────────────────────────────────────────────────────────

export const PAPER_PORTFOLIO_SCHEMA = `
  CREATE TABLE IF NOT EXISTS paper_balances (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    asset      TEXT    NOT NULL UNIQUE,
    amount     REAL    NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS paper_trades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     TEXT,
    venue       TEXT    NOT NULL,
    action_type TEXT    NOT NULL,
    symbol      TEXT,
    side        TEXT,
    price       REAL,
    size        REAL,
    amount_usd  REAL,
    order_id    TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'FILLED',
    created_at  INTEGER NOT NULL
  );
`;

const STARTING_USDC = 10_000;

// ── Internal helpers ──────────────────────────────────────────────────────────

let _testDb: Database.Database | null = null;

function getDb(): Database.Database {
  return _testDb ?? getMemoryDb();
}

function ensureSeed(): void {
  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) as c FROM paper_balances').get() as { c: number }).c;
  if (count === 0) {
    db.prepare('INSERT OR IGNORE INTO paper_balances (asset, amount, updated_at) VALUES (?, ?, ?)').run(
      'USDC',
      STARTING_USDC,
      Date.now()
    );
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type PaperBalance = {
  asset: string;
  amount: number;
  updated_at: number;
};

export type PaperTradeInput = {
  task_id?: string;
  venue: string;
  action_type: string;
  symbol?: string;
  side?: string;
  price?: number;
  size?: number;
  amount_usd?: number;
};

export type PaperTrade = {
  id: number;
  task_id?: string;
  venue: string;
  action_type: string;
  symbol?: string;
  side?: string;
  price?: number;
  size?: number;
  amount_usd?: number;
  order_id: string;
  status: string;
  created_at: number;
};

export type PaperPortfolioSummary = {
  balances: PaperBalance[];
  totalUsd: number;
  tradeCount: number;
  recentTrades: PaperTrade[];
};

// ── Public API ────────────────────────────────────────────────────────────────

/** Get balance for a single asset. Auto-seeds portfolio on first call. */
export function getPaperBalance(asset: string): number {
  ensureSeed();
  const row = getDb().prepare('SELECT amount FROM paper_balances WHERE asset = ?').get(asset) as
    | { amount: number }
    | undefined;
  return row?.amount ?? 0;
}

/** Get all balances with amount > 0. */
export function getPaperBalances(): PaperBalance[] {
  ensureSeed();
  return getDb()
    .prepare('SELECT asset, amount, updated_at FROM paper_balances WHERE amount > 0 ORDER BY asset')
    .all() as PaperBalance[];
}

/** Adjust balance by delta (positive = add, negative = subtract). */
export function adjustPaperBalance(asset: string, delta: number): void {
  ensureSeed();
  const db = getDb();
  const now = Date.now();
  const existing = db.prepare('SELECT amount FROM paper_balances WHERE asset = ?').get(asset) as
    | { amount: number }
    | undefined;

  if (existing) {
    db.prepare('UPDATE paper_balances SET amount = amount + ?, updated_at = ? WHERE asset = ?').run(delta, now, asset);
  } else {
    db.prepare('INSERT INTO paper_balances (asset, amount, updated_at) VALUES (?, ?, ?)').run(asset, delta, now);
  }
}

/** Record a paper trade. Returns the generated orderId. */
export function recordPaperTrade(input: PaperTradeInput): string {
  const orderId = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  getDb()
    .prepare(
      `INSERT INTO paper_trades
        (task_id, venue, action_type, symbol, side, price, size, amount_usd, order_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'FILLED', ?)`
    )
    .run(
      input.task_id ?? null,
      input.venue,
      input.action_type,
      input.symbol ?? null,
      input.side ?? null,
      input.price ?? null,
      input.size ?? null,
      input.amount_usd ?? null,
      orderId,
      Date.now()
    );
  return orderId;
}

/** Get paper trades, optionally filtered by venue and/or limited. */
export function getPaperTrades(opts: { venue?: string; limit?: number } = {}): PaperTrade[] {
  let sql = 'SELECT * FROM paper_trades';
  const args: unknown[] = [];
  if (opts.venue) {
    sql += ' WHERE venue = ?';
    args.push(opts.venue);
  }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT ?';
  args.push(opts.limit ?? 50);
  return getDb()
    .prepare(sql)
    .all(...args) as PaperTrade[];
}

/** Summarize the paper portfolio. */
export function getPaperPortfolioSummary(): PaperPortfolioSummary {
  ensureSeed();
  const balances = getPaperBalances();
  // Simple approximation: sum USDC + any other stable-ish assets at face value
  const totalUsd = balances.reduce((sum, b) => {
    // Only count USDC directly; other assets counted as 0 in USD for simplicity
    if (b.asset === 'USDC' || b.asset === 'USDT' || b.asset === 'DAI') return sum + b.amount;
    return sum;
  }, 0);

  const tradeCount = (getDb().prepare('SELECT COUNT(*) as c FROM paper_trades').get() as { c: number }).c;

  const recentTrades = getPaperTrades({ limit: 10 });

  return { balances, totalUsd, tradeCount, recentTrades };
}

/** Reset the paper portfolio to a fresh state. */
export function resetPaperPortfolio(startingUsdc = STARTING_USDC): void {
  const db = getDb();
  db.prepare('DELETE FROM paper_balances').run();
  db.prepare('DELETE FROM paper_trades').run();
  db.prepare('INSERT INTO paper_balances (asset, amount, updated_at) VALUES (?, ?, ?)').run(
    'USDC',
    startingUsdc,
    Date.now()
  );
}

/**
 * Replace the shared db handle with a fresh in-memory instance for tests.
 * Must be called before any other paper-portfolio function in the test file.
 */
export function _initPaperDbForTest(): void {
  if (_testDb) {
    try {
      _testDb.close();
    } catch {
      /* ok */
    }
  }
  _testDb = new Database(':memory:');
  _testDb.pragma('journal_mode = WAL');
  _testDb.exec(PAPER_PORTFOLIO_SCHEMA);
}

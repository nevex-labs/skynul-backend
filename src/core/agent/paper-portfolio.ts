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

/** Persistent price sim: random walk that advances with time, not per-call. */
const _priceState = new Map<string, { price: number; ts: number }>();

function _simulatePrice(key: string, entryPrice: number): number {
  const now = Date.now();
  const state = _priceState.get(key);
  if (state) {
    // Advance price every 5 seconds with small random step (±0.3%)
    const elapsed = now - state.ts;
    const steps = Math.floor(elapsed / 5000);
    if (steps > 0) {
      let price = state.price;
      for (let i = 0; i < Math.min(steps, 20); i++) {
        const step = (Math.random() - 0.5) * 0.006; // ±0.3% neutral drift
        price *= 1 + step;
      }
      price = Math.max(entryPrice * 0.7, Math.min(entryPrice * 1.3, price)); // ±30% bounds
      _priceState.set(key, { price, ts: now });
      return price;
    }
    return state.price; // same price within 5s window
  }
  // First call: start near entry with tiny random offset
  const initial = entryPrice * (1 + (Math.random() - 0.5) * 0.002);
  _priceState.set(key, { price: initial, ts: now });
  return initial;
}

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

/**
 * Compute open paper positions from trade history.
 * Buys add shares, sells (close_position) subtract them.
 */
export async function getPaperPositions(venue?: string): Promise<PaperPosition[]> {
  let sql = 'SELECT * FROM paper_trades ORDER BY created_at ASC';
  const args: unknown[] = [];
  if (venue) {
    sql = 'SELECT * FROM paper_trades WHERE venue = ? ORDER BY created_at ASC';
    args.push(venue);
  }
  const trades = getDb().prepare(sql).all(...args) as PaperTrade[];

  const map = new Map<string, { shares: number; cost: number; side: string; venue: string }>();
  for (const t of trades) {
    if (!t.symbol) continue;
    const key = `${t.venue}:${t.symbol}`;
    const entry = map.get(key) ?? { shares: 0, cost: 0, side: t.side ?? 'buy', venue: t.venue };

    const units = t.size ?? t.amount_usd ?? 0;
    if (t.action_type.includes('close') || t.side === 'sell') {
      entry.shares -= units;
      entry.cost -= t.amount_usd ?? 0;
    } else {
      entry.shares += units;
      entry.cost += t.amount_usd ?? 0;
    }
    map.set(key, entry);
  }

  const positions: PaperPosition[] = [];
  for (const [key, v] of map) {
    if (v.shares > 0.001) {
      const symbol = key.split(':')[1] ?? key;
      const avgPrice = v.cost / v.shares;
      // Try real price for CEX venues, fall back to simulation
      let currentPrice: number;
      if (v.venue !== 'polymarket') {
        try {
          let res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
          if (!res.ok) res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
          if (res.ok) {
            const data = await res.json();
            currentPrice = Number.parseFloat(data.price);
          } else {
            currentPrice = _simulatePrice(key, avgPrice);
          }
        } catch {
          currentPrice = _simulatePrice(key, avgPrice);
        }
      } else {
        currentPrice = _simulatePrice(key, avgPrice);
      }
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

/**
 * Evaluation & Feedback Loop — Plan 5
 *
 * Phase 1: Task Outcome Scoring — deterministic scoring after each trading task
 * Phase 2: Performance Tracking — aggregation queries over trade_scores
 * Phase 3: Feedback Injection — format performance data for agent context
 */

import Database from 'better-sqlite3';
import type { Task, TaskCapabilityId } from '../../types';
import { getMemoryDb } from './task-memory';

// ── Re-export db handle for shared use ────────────────────────────────────────

// We piggyback on the existing memory.db via a shared handle accessor.
// For tests, we inject a fresh in-memory db via _initEvalDbForTest().

let testDb: Database.Database | null = null;

function getDb(): Database.Database {
  if (testDb) return testDb;
  return getMemoryDb();
}

export function _initEvalDbForTest(): void {
  if (testDb) {
    try {
      testDb.close();
    } catch {
      /* ok */
    }
  }
  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  initEvalSchema(testDb);
}

// ── Schema ────────────────────────────────────────────────────────────────────

export const TRADE_SCORES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS trade_scores (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       TEXT NOT NULL UNIQUE,
    venue         TEXT NOT NULL,
    capability    TEXT NOT NULL,
    symbol        TEXT,
    side          TEXT,
    entry_price   REAL,
    exit_price    REAL,
    size          REAL,
    pnl_usd       REAL NOT NULL DEFAULT 0,
    pnl_pct       REAL NOT NULL DEFAULT 0,
    score_pnl           REAL NOT NULL DEFAULT 0,
    score_discipline    REAL NOT NULL DEFAULT 0,
    score_efficiency    REAL NOT NULL DEFAULT 0,
    score_total         REAL NOT NULL DEFAULT 0,
    steps_used    INTEGER NOT NULL DEFAULT 0,
    max_steps     INTEGER NOT NULL DEFAULT 0,
    duration_ms   INTEGER NOT NULL DEFAULT 0,
    had_open_positions_at_done INTEGER NOT NULL DEFAULT 0,
    is_paper      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ts_venue ON trade_scores(venue);
  CREATE INDEX IF NOT EXISTS ts_capability ON trade_scores(capability);
  CREATE INDEX IF NOT EXISTS ts_created ON trade_scores(created_at);
  CREATE INDEX IF NOT EXISTS ts_paper ON trade_scores(is_paper);
`;

export function initEvalSchema(db: Database.Database): void {
  db.exec(TRADE_SCORES_SCHEMA);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TradeVenue = 'polymarket' | 'cex_binance' | 'cex_coinbase' | 'onchain';

export type ExtractedTrade = {
  symbol: string;
  side: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number | null;
  size: number;
  pnlUsd: number;
};

export type ScoreInput = {
  task: Task;
  venue: TradeVenue;
  capability: string;
  trades: ExtractedTrade[];
  durationMs: number;
  isPaper?: boolean;
  hadOpenPositionsAtDone?: boolean;
  stepsUsed?: number;
};

export type TradeScore = {
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

export type PerformanceSummary = {
  totalTasks: number;
  winRate: number;
  totalPnlUsd: number;
  avgScoreTotal: number;
  avgScoreDiscipline: number;
  avgScoreEfficiency: number;
  recentTasks: TradeScore[];
  byVenue: Partial<Record<TradeVenue, { count: number; pnlUsd: number; avgScore: number }>>;
};

// ── Trade Extraction ──────────────────────────────────────────────────────────

const TRADING_CAPS = new Set<TaskCapabilityId>(['polymarket.trading', 'cex.trading', 'onchain.trading']);

/**
 * Parse task steps to extract trade data.
 * Returns null if the task has no trading capabilities or no trade actions.
 */
export function extractTradesFromTask(task: Task): ReturnType<typeof buildExtraction> | null {
  const tradingCap = task.capabilities.find((c) => TRADING_CAPS.has(c));
  if (!tradingCap) return null;

  const venue = capToVenue(tradingCap, task);
  if (!venue) return null;

  const trades: ExtractedTrade[] = [];
  let hadOpenPositionsAtDone = false;
  let lastAccountSummaryBeforeDone: string | null = null;

  // Scan steps forward; track last account summary before done action
  for (const step of task.steps) {
    const a = step.action;

    if (a.type === 'polymarket_place_order') {
      trades.push({
        symbol: a.tokenId.slice(0, 16),
        side: a.side,
        entryPrice: a.price,
        exitPrice: null,
        size: a.size,
        pnlUsd: 0,
      });
    } else if (a.type === 'polymarket_get_account_summary' && step.result) {
      lastAccountSummaryBeforeDone = step.result;
    } else if (a.type === 'cex_place_order') {
      // Parse size from result: "Order placed on binance: buy 99.6 BTCUSDT | ..."
      const sizeMatch = step.result?.match(/:\s*(buy|sell)\s+([\d.]+)\s+(\S+)/);
      const parsedSide = a.side;
      const parsedSize = sizeMatch ? Number.parseFloat(sizeMatch[2]) : a.amount;
      trades.push({
        symbol: a.symbol,
        side: parsedSide,
        entryPrice: a.price ?? 0,
        exitPrice: null,
        size: parsedSize,
        pnlUsd: 0,
      });
    } else if (a.type === 'chain_swap') {
      trades.push({
        symbol: `${a.tokenIn}→${a.tokenOut}`,
        side: 'buy',
        entryPrice: 0,
        exitPrice: null,
        size: Number.parseFloat(a.amountIn) || 0,
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

  return buildExtraction(venue, tradingCap, trades, hadOpenPositionsAtDone);
}

function buildExtraction(
  venue: TradeVenue,
  capability: string,
  trades: ExtractedTrade[],
  hadOpenPositionsAtDone: boolean
) {
  return { venue, capability, trades, hadOpenPositionsAtDone };
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

// ── Scoring ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function computeScore(input: ScoreInput): {
  scorePnl: number;
  scoreDiscipline: number;
  scoreEfficiency: number;
  scoreTotal: number;
  totalPnlUsd: number;
  pnlPct: number;
} {
  const { task, trades, hadOpenPositionsAtDone = false, stepsUsed } = input;

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
  if (task.status === 'failed') scoreDiscipline -= 0.2;
  if (task.status === 'cancelled') scoreDiscipline -= 0.1;
  scoreDiscipline = clamp(scoreDiscipline, 0, 1.0);

  // scoreEfficiency (weight 0.25)
  const effectiveSteps = stepsUsed ?? task.steps.length;
  const stepRatio = task.maxSteps > 0 ? effectiveSteps / task.maxSteps : 1;
  let scoreEfficiency: number;
  if (task.status === 'completed') {
    scoreEfficiency = clamp(1.0 - stepRatio * 0.5, 0, 1.0);
  } else {
    scoreEfficiency = clamp(0.3 - stepRatio, 0, 1.0);
  }

  const scoreTotal = clamp(scorePnl * 0.4 + scoreDiscipline * 0.35 + scoreEfficiency * 0.25, 0, 1.0);

  return { scorePnl, scoreDiscipline, scoreEfficiency, scoreTotal, totalPnlUsd, pnlPct };
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Score a task's trading outcome and persist to trade_scores table.
 * Throws if task_id already exists (UNIQUE constraint).
 * Returns the inserted row id.
 */
export function saveTradeScore(input: ScoreInput): number {
  const { task, venue, capability, trades, durationMs, isPaper = false, hadOpenPositionsAtDone = false } = input;
  const scores = computeScore(input);
  const firstTrade = trades[0] ?? null;

  const result = getDb()
    .prepare(
      `INSERT INTO trade_scores
        (task_id, venue, capability, symbol, side, entry_price, exit_price, size,
         pnl_usd, pnl_pct, score_pnl, score_discipline, score_efficiency, score_total,
         steps_used, max_steps, duration_ms, had_open_positions_at_done, is_paper, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      task.id,
      venue,
      capability,
      firstTrade?.symbol ?? null,
      firstTrade?.side ?? null,
      firstTrade?.entryPrice ?? null,
      firstTrade?.exitPrice ?? null,
      firstTrade?.size ?? null,
      scores.totalPnlUsd,
      scores.pnlPct,
      scores.scorePnl,
      scores.scoreDiscipline,
      scores.scoreEfficiency,
      scores.scoreTotal,
      input.stepsUsed ?? task.steps.length,
      task.maxSteps,
      durationMs,
      hadOpenPositionsAtDone ? 1 : 0,
      isPaper ? 1 : 0,
      Date.now()
    );
  return result.lastInsertRowid as number;
}

function rowToTradeScore(row: Record<string, unknown>): TradeScore {
  return {
    id: row.id as number,
    taskId: row.task_id as string,
    venue: row.venue as TradeVenue,
    capability: row.capability as string,
    symbol: row.symbol as string | null,
    side: row.side as string | null,
    entryPrice: row.entry_price as number | null,
    exitPrice: row.exit_price as number | null,
    size: row.size as number | null,
    pnlUsd: row.pnl_usd as number,
    pnlPct: row.pnl_pct as number,
    scorePnl: row.score_pnl as number,
    scoreDiscipline: row.score_discipline as number,
    scoreEfficiency: row.score_efficiency as number,
    scoreTotal: row.score_total as number,
    stepsUsed: row.steps_used as number,
    maxSteps: row.max_steps as number,
    durationMs: row.duration_ms as number,
    hadOpenPositionsAtDone: (row.had_open_positions_at_done as number) === 1,
    isPaper: (row.is_paper as number) === 1,
    createdAt: row.created_at as number,
  };
}

export function getTaskScore(taskId: string): TradeScore | null {
  const row = getDb().prepare(`SELECT * FROM trade_scores WHERE task_id = ?`).get(taskId) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToTradeScore(row) : null;
}

// ── Performance Tracking ──────────────────────────────────────────────────────

const ZEROED_SUMMARY: PerformanceSummary = {
  totalTasks: 0,
  winRate: 0,
  totalPnlUsd: 0,
  avgScoreTotal: 0,
  avgScoreDiscipline: 0,
  avgScoreEfficiency: 0,
  recentTasks: [],
  byVenue: {},
};

export function getPerformanceSummary(
  opts: {
    days?: number;
    venue?: TradeVenue;
    paperOnly?: boolean;
    limit?: number;
  } = {}
): PerformanceSummary {
  try {
    let where = 'WHERE 1=1';
    const args: unknown[] = [];

    if (opts.days && opts.days > 0) {
      where += ' AND created_at >= ?';
      args.push(Date.now() - opts.days * 86_400_000);
    }
    if (opts.venue) {
      where += ' AND venue = ?';
      args.push(opts.venue);
    }
    if (opts.paperOnly === true) {
      where += ' AND is_paper = 1';
    } else if (opts.paperOnly === false) {
      where += ' AND is_paper = 0';
    }

    const agg = getDb()
      .prepare(
        `SELECT
           COUNT(*) as total,
           AVG(score_total) as avg_total,
           AVG(score_discipline) as avg_disc,
           AVG(score_efficiency) as avg_eff,
           SUM(pnl_usd) as sum_pnl,
           SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) * 1.0 / MAX(COUNT(*), 1) as win_rate
         FROM trade_scores ${where}`
      )
      .get(...args) as Record<string, number | null>;

    const total = (agg.total as number) ?? 0;
    if (total === 0) return { ...ZEROED_SUMMARY };

    const limit = opts.limit ?? 5;
    const recent = getDb()
      .prepare(`SELECT * FROM trade_scores ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...args, limit) as Record<string, unknown>[];

    // by venue breakdown
    const venueRows = getDb()
      .prepare(
        `SELECT venue, COUNT(*) as cnt, SUM(pnl_usd) as pnl, AVG(score_total) as avg_s
         FROM trade_scores ${where}
         GROUP BY venue`
      )
      .all(...args) as { venue: string; cnt: number; pnl: number; avg_s: number }[];

    const byVenue: PerformanceSummary['byVenue'] = {};
    for (const v of venueRows) {
      byVenue[v.venue as TradeVenue] = { count: v.cnt, pnlUsd: v.pnl, avgScore: v.avg_s };
    }

    return {
      totalTasks: total,
      winRate: (agg.win_rate as number) ?? 0,
      totalPnlUsd: (agg.sum_pnl as number) ?? 0,
      avgScoreTotal: (agg.avg_total as number) ?? 0,
      avgScoreDiscipline: (agg.avg_disc as number) ?? 0,
      avgScoreEfficiency: (agg.avg_eff as number) ?? 0,
      recentTasks: recent.map(rowToTradeScore),
      byVenue,
    };
  } catch {
    return { ...ZEROED_SUMMARY };
  }
}

// ── Feedback Formatting ───────────────────────────────────────────────────────

export function formatPerformanceForPrompt(summary: PerformanceSummary): string {
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

  return `\n## TRADING PERFORMANCE (your track record — use this to improve):
- Win rate: ${winPct}% (${summary.totalTasks} trades total)
- Total PnL: ${pnlSign}$${summary.totalPnlUsd.toFixed(2)}
- Avg score: ${summary.avgScoreTotal.toFixed(2)}/1.00 (discipline: ${summary.avgScoreDiscipline.toFixed(2)}, efficiency: ${summary.avgScoreEfficiency.toFixed(2)})${disciplineWarning}
${recentLines ? `- Recent:\n${recentLines}` : ''}
`;
}

const TRADING_CAP_SET = new Set(['polymarket.trading', 'cex.trading', 'onchain.trading']);

export function buildFeedbackContext(capabilities: string[]): string {
  const hasTradingCap = capabilities.some((c) => TRADING_CAP_SET.has(c));
  if (!hasTradingCap) return '';
  const summary = getPerformanceSummary({ days: 30, limit: 3 });
  if (summary.totalTasks === 0) return '';
  return formatPerformanceForPrompt(summary);
}

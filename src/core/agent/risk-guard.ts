/**
 * RiskGuard — programmatic trade guardrails.
 *
 * Intercepts trading actions BEFORE execution and blocks them when configured
 * limits are exceeded. Works independently of paper mode (paper trades bypass
 * all risk checks — they're virtual by design).
 *
 * Config persisted in risk.json via getDataDir(). The agent can read/write
 * the file directly; no dedicated API endpoint needed.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import { getDataDir } from '../config';
import { getMemoryDb } from './task-memory';

// ── Schema ────────────────────────────────────────────────────────────────────

export const RISK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS risk_daily_volume (
    date       TEXT NOT NULL,
    venue      TEXT NOT NULL,
    volume_usd REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (date, venue)
  );
  CREATE TABLE IF NOT EXISTS risk_positions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    venue      TEXT    NOT NULL,
    symbol     TEXT    NOT NULL,
    side       TEXT    NOT NULL,
    size_usd   REAL    NOT NULL,
    task_id    TEXT,
    opened_at  INTEGER NOT NULL,
    closed_at  INTEGER,
    mode       TEXT    DEFAULT 'task', -- 'task' or 'yolo'
    entry_price REAL,
    exit_price  REAL,
    pnl_usd     REAL
  );
  CREATE INDEX IF NOT EXISTS rp_open ON risk_positions(venue, closed_at);
  CREATE INDEX IF NOT EXISTS rp_task ON risk_positions(task_id);
  CREATE INDEX IF NOT EXISTS rp_mode ON risk_positions(mode);
  
  -- YOLO mode tracking
  CREATE TABLE IF NOT EXISTS yolo_trades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT    NOT NULL,
    chain       TEXT    NOT NULL,
    side        TEXT    NOT NULL,
    size_usd    REAL    NOT NULL,
    entry_price REAL    NOT NULL,
    exit_price  REAL,
    pnl_usd     REAL,
    opened_at   INTEGER NOT NULL,
    closed_at   INTEGER,
    exit_reason TEXT, -- 'take_profit', 'stop_loss', 'time_limit', 'rug_pull', 'manual'
    task_id     TEXT
  );
  CREATE INDEX IF NOT EXISTS yolo_token ON yolo_trades(token);
  CREATE INDEX IF NOT EXISTS yolo_date ON yolo_trades(opened_at);
`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type VenueId = 'polymarket' | 'chain' | 'binance' | 'coinbase';

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

export type RiskPosition = {
  id: number;
  venue: string;
  symbol: string;
  side: string;
  sizeUsd: number;
  taskId: string | null;
  openedAt: number;
  closedAt: number | null;
  mode?: TradingMode;
  entryPrice?: number;
  exitPrice?: number;
  pnlUsd?: number;
};

// ── Defaults ──────────────────────────────────────────────────────────────────

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

// Mode-specific configs
export type TradingMode = 'task' | 'yolo';

export type ModeRiskConfig = {
  task: RiskLimits;
  yolo: RiskLimits;
};

export const DEFAULT_MODE_CONFIG: ModeRiskConfig = {
  task: { ...DEFAULT_RISK_LIMITS },
  yolo: { ...DEFAULT_YOLO_RISK_LIMITS },
};

// ── Test DB injection ─────────────────────────────────────────────────────────

let _testDb: Database.Database | null = null;

function getDb(): Database.Database {
  return _testDb ?? getMemoryDb();
}

export function _initRiskDbForTest(): void {
  if (_testDb) {
    try {
      _testDb.close();
    } catch {
      /* ok */
    }
  }
  _testDb = new Database(':memory:');
  _testDb.pragma('journal_mode = WAL');
  _testDb.exec(RISK_SCHEMA);
  // Reset cached config
  _configCache = null;
}

/** Override the in-memory config cache without touching disk (tests only). */
export function _setRiskConfigForTest(config: RiskConfig): void {
  _configCache = config;
}

// ── Config persistence ────────────────────────────────────────────────────────

let _configCache: RiskConfig | null = null;

function configFilePath(): string {
  return join(getDataDir(), 'risk.json');
}

export function loadRiskConfig(): RiskConfig {
  if (_configCache) return _configCache;
  try {
    const raw = readFileSync(configFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<RiskConfig>;
    _configCache = {
      global: { ...DEFAULT_RISK_LIMITS, ...(parsed.global ?? {}) },
      venues: parsed.venues ?? {},
    };
    return _configCache;
  } catch {
    return { ...DEFAULT_RISK_CONFIG };
  }
}

export function saveRiskConfig(config: RiskConfig): void {
  const f = configFilePath();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(config, null, 2), 'utf8');
  _configCache = config;
}

// ── Limit resolution ──────────────────────────────────────────────────────────

export function getEffectiveLimits(config: RiskConfig, venue: VenueId): RiskLimits {
  const override = config.venues[venue] ?? {};
  return { ...config.global, ...override };
}

// ── Daily volume ──────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}

export function getDailyVolume(venue?: VenueId): number {
  const date = todayKey();
  try {
    if (venue) {
      const row = getDb()
        .prepare('SELECT volume_usd FROM risk_daily_volume WHERE date = ? AND venue = ?')
        .get(date, venue) as { volume_usd: number } | undefined;
      return row?.volume_usd ?? 0;
    }
    const row = getDb().prepare('SELECT SUM(volume_usd) as total FROM risk_daily_volume WHERE date = ?').get(date) as {
      total: number | null;
    };
    return row?.total ?? 0;
  } catch {
    return 0;
  }
}

export function recordTradeVolume(venue: VenueId, amountUsd: number): void {
  const date = todayKey();
  try {
    getDb()
      .prepare(`
        INSERT INTO risk_daily_volume (date, venue, volume_usd)
        VALUES (?, ?, ?)
        ON CONFLICT(date, venue) DO UPDATE SET volume_usd = volume_usd + excluded.volume_usd
      `)
      .run(date, venue, amountUsd);
  } catch {
    /* non-critical */
  }
}

// ── Position tracking ─────────────────────────────────────────────────────────

export function getOpenPositionCount(venue?: VenueId): number {
  try {
    if (venue) {
      const row = getDb()
        .prepare('SELECT COUNT(*) as c FROM risk_positions WHERE venue = ? AND closed_at IS NULL')
        .get(venue) as { c: number };
      return row.c;
    }
    const row = getDb().prepare('SELECT COUNT(*) as c FROM risk_positions WHERE closed_at IS NULL').get() as {
      c: number;
    };
    return row.c;
  } catch {
    return 0;
  }
}

export function getOpenPositions(venue?: VenueId): RiskPosition[] {
  try {
    let sql = 'SELECT * FROM risk_positions WHERE closed_at IS NULL';
    const args: unknown[] = [];
    if (venue) {
      sql += ' AND venue = ?';
      args.push(venue);
    }
    sql += ' ORDER BY opened_at DESC';
    const rows = getDb()
      .prepare(sql)
      .all(...args) as Record<string, unknown>[];
    return rows.map(rowToPosition);
  } catch {
    return [];
  }
}

export function openRiskPosition(
  venue: VenueId,
  symbol: string,
  side: string,
  sizeUsd: number,
  taskId?: string,
  mode: TradingMode = 'task',
  entryPrice?: number
): number {
  try {
    const result = getDb()
      .prepare(
        'INSERT INTO risk_positions (venue, symbol, side, size_usd, task_id, opened_at, mode, entry_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(venue, symbol, side, sizeUsd, taskId ?? null, Date.now(), mode, entryPrice ?? null);

    // If YOLO mode, also track in yolo_trades
    if (mode === 'yolo' && entryPrice) {
      getDb()
        .prepare(
          'INSERT INTO yolo_trades (token, chain, side, size_usd, entry_price, opened_at, task_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(symbol, venue, side, sizeUsd, entryPrice, Date.now(), taskId ?? null);
    }

    return result.lastInsertRowid as number;
  } catch {
    return -1;
  }
}

export function closeRiskPosition(positionId: number, exitPrice?: number, exitReason?: string): void {
  try {
    // Get position details to calculate P&L
    const position = getDb().prepare('SELECT * FROM risk_positions WHERE id = ?').get(positionId) as
      | Record<string, unknown>
      | undefined;

    let pnlUsd: number | null = null;
    if (position && exitPrice && position.entry_price) {
      const entryPrice = position.entry_price as number;
      const sizeUsd = position.size_usd as number;
      const side = position.side as string;

      // Calculate P&L
      const priceDiff = exitPrice - entryPrice;
      pnlUsd = side === 'buy' ? sizeUsd * (priceDiff / entryPrice) : sizeUsd * (-priceDiff / entryPrice);
    }

    getDb()
      .prepare('UPDATE risk_positions SET closed_at = ?, exit_price = ?, pnl_usd = ? WHERE id = ?')
      .run(Date.now(), exitPrice ?? null, pnlUsd, positionId);

    // Update yolo_trades if applicable
    if (position?.mode === 'yolo' && exitPrice) {
      getDb()
        .prepare(
          'UPDATE yolo_trades SET exit_price = ?, pnl_usd = ?, closed_at = ?, exit_reason = ? WHERE task_id = ? AND token = ? AND closed_at IS NULL'
        )
        .run(exitPrice, pnlUsd, Date.now(), exitReason ?? 'manual', position.task_id, position.symbol);
    }
  } catch {
    /* non-critical */
  }
}

export function closeAllPositionsForTask(taskId: string): void {
  try {
    getDb()
      .prepare('UPDATE risk_positions SET closed_at = ? WHERE task_id = ? AND closed_at IS NULL')
      .run(Date.now(), taskId);
  } catch {
    /* non-critical */
  }
}

function rowToPosition(row: Record<string, unknown>): RiskPosition {
  return {
    id: row.id as number,
    venue: row.venue as string,
    symbol: row.symbol as string,
    side: row.side as string,
    sizeUsd: row.size_usd as number,
    taskId: row.task_id as string | null,
    openedAt: row.opened_at as number,
    closedAt: row.closed_at as number | null,
    mode: (row.mode as TradingMode) ?? 'task',
    entryPrice: row.entry_price as number | undefined,
    exitPrice: row.exit_price as number | undefined,
    pnlUsd: row.pnl_usd as number | undefined,
  };
}

// ── The main guard ────────────────────────────────────────────────────────────

/**
 * Check whether a trade is allowed given current risk limits.
 * Call BEFORE executing any live trade action.
 * On approval, call recordTradeVolume() + openRiskPosition() after the trade.
 */
export function checkTradeAllowed(venue: VenueId, amountUsd: number): RiskCheckResult {
  const config = loadRiskConfig();
  const limits = getEffectiveLimits(config, venue);

  if (!limits.enabled) return { allowed: true };

  if (amountUsd > limits.maxSingleTradeUsd) {
    return {
      allowed: false,
      reason: `Trade size $${amountUsd.toFixed(2)} exceeds max single trade limit of $${limits.maxSingleTradeUsd} on ${venue}. Reduce trade size.`,
    };
  }

  const dailyVol = getDailyVolume(venue);
  if (dailyVol + amountUsd > limits.maxDailyVolumeUsd) {
    const remaining = Math.max(0, limits.maxDailyVolumeUsd - dailyVol);
    return {
      allowed: false,
      reason: `Daily volume limit reached on ${venue}. Used $${dailyVol.toFixed(2)} of $${limits.maxDailyVolumeUsd} today. Remaining: $${remaining.toFixed(2)}.`,
    };
  }

  const openCount = getOpenPositionCount(venue);
  if (openCount >= limits.maxConcurrentPositions) {
    return {
      allowed: false,
      reason: `Max ${limits.maxConcurrentPositions} concurrent positions reached on ${venue}. Close existing positions before opening new ones.`,
    };
  }

  return { allowed: true };
}

// ── YOLO Mode specific checks ─────────────────────────────────────────────────

export type YoloCheckResult = { allowed: true } | { allowed: false; reason: string; suggestedFix?: string };

/**
 * Check if token meets YOLO mode criteria before entering.
 * Validates liquidity, holder count, and other safety metrics.
 */
export function checkYoloEntryCriteria(
  tokenInfo: {
    liquidityUsd: number;
    uniqueHolders: number;
    topHolderPercent: number;
    devHoldingPercent: number;
    mintAuthority?: boolean;
    freezeAuthority?: boolean;
    ageMinutes: number;
  },
  mode: TradingMode = 'yolo'
): YoloCheckResult {
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
}

/**
 * Check daily loss limit for YOLO mode.
 * Call before each trade to ensure we haven't hit daily stop loss.
 */
export function checkDailyLossLimit(mode: TradingMode = 'yolo'): YoloCheckResult {
  if (mode !== 'yolo') return { allowed: true };

  const config = DEFAULT_MODE_CONFIG.yolo;
  if (!config.maxDailyLossUsd) return { allowed: true };

  const dailyPnl = getDailyPnl();
  if (dailyPnl < -config.maxDailyLossUsd) {
    return {
      allowed: false,
      reason: `Daily loss limit reached: $${Math.abs(dailyPnl).toFixed(2)} / $${config.maxDailyLossUsd}. Stopping for today.`,
    };
  }

  return { allowed: true };
}

/**
 * Check if enough time has passed since last trade (cooldown).
 */
export function checkTradeCooldown(mode: TradingMode = 'yolo'): YoloCheckResult {
  if (mode !== 'yolo') return { allowed: true };

  const config = DEFAULT_MODE_CONFIG.yolo;
  if (!config.tradeCooldownSeconds) return { allowed: true };

  const lastTrade = getLastTradeTime();
  const elapsed = (Date.now() - lastTrade) / 1000;

  if (elapsed < config.tradeCooldownSeconds) {
    const remaining = Math.ceil(config.tradeCooldownSeconds - elapsed);
    return {
      allowed: false,
      reason: `Trade cooldown: ${remaining}s remaining`,
    };
  }

  return { allowed: true };
}

// ── Auto-exec triggers ────────────────────────────────────────────────────────

export type ExitTrigger =
  | { type: 'take_profit'; profitPercent: number; profitUsd: number }
  | { type: 'stop_loss'; lossPercent: number; lossUsd: number }
  | { type: 'time_limit'; holdTimeSeconds: number }
  | { type: 'rug_pull'; reason: string }
  | { type: 'manual' };

/**
 * Check if position should be auto-closed based on YOLO exit criteria.
 * Call periodically to monitor open positions.
 */
export function checkExitTriggers(
  position: {
    entryPrice: number;
    currentPrice: number;
    sizeUsd: number;
    openedAt: number;
  },
  mode: TradingMode = 'yolo'
): ExitTrigger | null {
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
}

// ── Helper functions (placeholders - implement with real data) ───────────────

function getDailyPnl(): number {
  // TODO: Calculate from risk_positions table
  // Sum of (exit_price - entry_price) * size for closed positions today
  return 0;
}

function getLastTradeTime(): number {
  // TODO: Get timestamp of most recent trade
  return 0;
}

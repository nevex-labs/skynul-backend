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
    closed_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS rp_open ON risk_positions(venue, closed_at);
  CREATE INDEX IF NOT EXISTS rp_task ON risk_positions(task_id);
`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type VenueId =
  | 'polymarket'
  | 'chain'
  | 'binance'
  | 'coinbase'
  | 'fiat_prometeo'
  | 'fiat_plaid'
  | 'fiat_manual'
  | 'crypto_coinbase'
  | 'crypto_manual'
  | 'crypto_transak'
  | 'crypto_ripio';

export type RiskLimits = {
  /** Max USD value for a single trade. Default: 500 */
  maxSingleTradeUsd: number;
  /** Max total USD traded across all venues today. Default: 5000 */
  maxDailyVolumeUsd: number;
  /** Max open (unclosed) positions at once per venue. Default: 5 */
  maxConcurrentPositions: number;
  /** Global kill switch — false bypasses all checks. Default: true */
  enabled: boolean;
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
};

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxSingleTradeUsd: 500,
  maxDailyVolumeUsd: 5_000,
  maxConcurrentPositions: 5,
  enabled: true,
};

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  global: { ...DEFAULT_RISK_LIMITS },
  venues: {},
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
  taskId?: string
): number {
  try {
    const result = getDb()
      .prepare(
        'INSERT INTO risk_positions (venue, symbol, side, size_usd, task_id, opened_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(venue, symbol, side, sizeUsd, taskId ?? null, Date.now());
    return result.lastInsertRowid as number;
  } catch {
    return -1;
  }
}

export function closeRiskPosition(positionId: number): void {
  try {
    getDb().prepare('UPDATE risk_positions SET closed_at = ? WHERE id = ?').run(Date.now(), positionId);
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

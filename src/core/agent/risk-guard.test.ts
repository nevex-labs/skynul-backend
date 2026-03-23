import { describe, it, expect, beforeEach } from 'vitest';
import {
  _initRiskDbForTest,
  _setRiskConfigForTest,
  checkTradeAllowed,
  recordTradeVolume,
  getDailyVolume,
  getOpenPositionCount,
  getOpenPositions,
  openRiskPosition,
  closeRiskPosition,
  closeAllPositionsForTask,
  getEffectiveLimits,
  DEFAULT_RISK_CONFIG,
  DEFAULT_RISK_LIMITS,
  type RiskConfig,
} from './risk-guard';

beforeEach(() => {
  _initRiskDbForTest();
  // Mock readFileSync to simulate no risk.json on disk
  vi.resetModules();
});

// ── getEffectiveLimits ────────────────────────────────────────────────────────

describe('getEffectiveLimits', () => {
  it('returns global limits when no venue override', () => {
    const limits = getEffectiveLimits(DEFAULT_RISK_CONFIG, 'binance');
    expect(limits).toEqual(DEFAULT_RISK_LIMITS);
  });

  it('merges venue overrides on top of global', () => {
    const config: RiskConfig = {
      global: { ...DEFAULT_RISK_LIMITS, maxSingleTradeUsd: 500 },
      venues: { binance: { maxSingleTradeUsd: 1000 } },
    };
    const limits = getEffectiveLimits(config, 'binance');
    expect(limits.maxSingleTradeUsd).toBe(1000);
    expect(limits.maxDailyVolumeUsd).toBe(DEFAULT_RISK_LIMITS.maxDailyVolumeUsd);
  });

  it('venue override can relax a limit', () => {
    const config: RiskConfig = {
      global: { ...DEFAULT_RISK_LIMITS, maxConcurrentPositions: 2 },
      venues: { polymarket: { maxConcurrentPositions: 10 } },
    };
    const limits = getEffectiveLimits(config, 'polymarket');
    expect(limits.maxConcurrentPositions).toBe(10);
  });

  it('unrelated venue uses global only', () => {
    const config: RiskConfig = {
      global: { ...DEFAULT_RISK_LIMITS },
      venues: { coinbase: { maxSingleTradeUsd: 999 } },
    };
    const limits = getEffectiveLimits(config, 'binance');
    expect(limits.maxSingleTradeUsd).toBe(DEFAULT_RISK_LIMITS.maxSingleTradeUsd);
  });
});

// ── checkTradeAllowed ─────────────────────────────────────────────────────────

describe('checkTradeAllowed', () => {
  it('allows trade under all limits', () => {
    const result = checkTradeAllowed('binance', 100);
    expect(result.allowed).toBe(true);
  });

  it('blocks trade exceeding maxSingleTradeUsd', () => {
    const result = checkTradeAllowed('binance', 600);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain('exceeds max single trade');
  });

  it('blocks trade when daily volume would be exceeded', () => {
    recordTradeVolume('chain', 4900);
    const result = checkTradeAllowed('chain', 200);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain('Daily volume limit');
  });

  it('allows trade that exactly hits daily limit (not over)', () => {
    recordTradeVolume('chain', 4500);
    const result = checkTradeAllowed('chain', 499); // 4500+499=4999 < 5000
    expect(result.allowed).toBe(true);
  });

  it('blocks when maxConcurrentPositions reached', () => {
    for (let i = 0; i < 5; i++) {
      openRiskPosition('polymarket', `token-${i}`, 'buy', 50);
    }
    const result = checkTradeAllowed('polymarket', 50);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain('Max 5 concurrent positions');
  });

  it('enabled=false bypasses all checks', () => {
    _setRiskConfigForTest({
      global: { ...DEFAULT_RISK_LIMITS, enabled: false, maxSingleTradeUsd: 1 },
      venues: {},
    });
    const result = checkTradeAllowed('binance', 99999);
    expect(result.allowed).toBe(true);
  });
});

// ── recordTradeVolume / getDailyVolume ────────────────────────────────────────

describe('recordTradeVolume + getDailyVolume', () => {
  it('starts at 0', () => {
    expect(getDailyVolume('binance')).toBe(0);
  });

  it('accumulates multiple recordings for same venue', () => {
    recordTradeVolume('binance', 100);
    recordTradeVolume('binance', 250);
    expect(getDailyVolume('binance')).toBeCloseTo(350);
  });

  it('different venues tracked separately', () => {
    recordTradeVolume('binance', 100);
    recordTradeVolume('polymarket', 200);
    expect(getDailyVolume('binance')).toBeCloseTo(100);
    expect(getDailyVolume('polymarket')).toBeCloseTo(200);
  });

  it('getDailyVolume without venue sums all', () => {
    recordTradeVolume('binance', 100);
    recordTradeVolume('chain', 150);
    expect(getDailyVolume()).toBeCloseTo(250);
  });
});

// ── openRiskPosition / closeRiskPosition ─────────────────────────────────────

describe('position lifecycle', () => {
  it('opens a position and counts it', () => {
    openRiskPosition('binance', 'BTC/USDT', 'buy', 200);
    expect(getOpenPositionCount('binance')).toBe(1);
  });

  it('closing removes from open count', () => {
    const id = openRiskPosition('coinbase', 'ETH-USD', 'buy', 150);
    expect(getOpenPositionCount('coinbase')).toBe(1);
    closeRiskPosition(id);
    expect(getOpenPositionCount('coinbase')).toBe(0);
  });

  it('getOpenPositions returns only open ones', () => {
    openRiskPosition('binance', 'SOL/USDT', 'buy', 100);
    const id2 = openRiskPosition('binance', 'BTC/USDT', 'buy', 200);
    closeRiskPosition(id2);
    const open = getOpenPositions('binance');
    expect(open).toHaveLength(1);
    expect(open[0].symbol).toBe('SOL/USDT');
  });

  it('closeAllPositionsForTask closes only that task', () => {
    openRiskPosition('chain', 'ETH', 'swap', 100, 'task-A');
    openRiskPosition('chain', 'BTC', 'swap', 100, 'task-A');
    openRiskPosition('chain', 'SOL', 'swap', 100, 'task-B');
    closeAllPositionsForTask('task-A');
    expect(getOpenPositionCount('chain')).toBe(1);
    const open = getOpenPositions('chain');
    expect(open[0].taskId).toBe('task-B');
  });
});

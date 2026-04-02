import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_YOLO_RISK_LIMITS,
  type ExitTrigger,
  type YoloCheckResult,
  checkDailyLossLimit,
  checkExitTriggers,
  checkTradeCooldown,
  checkYoloEntryCriteria,
} from './risk-guard';

describe('YOLO Risk Guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('checkYoloEntryCriteria', () => {
    it('allows token that meets all criteria', () => {
      const result = checkYoloEntryCriteria(
        {
          liquidityUsd: 100_000,
          uniqueHolders: 500,
          topHolderPercent: 10,
          devHoldingPercent: 5,
          mintAuthority: false,
          freezeAuthority: false,
          ageMinutes: 10,
        },
        'yolo'
      );

      expect(result.allowed).toBe(true);
    });

    it('blocks token with low liquidity', () => {
      const result = checkYoloEntryCriteria(
        {
          liquidityUsd: 10_000, // Too low
          uniqueHolders: 500,
          topHolderPercent: 10,
          devHoldingPercent: 5,
          mintAuthority: false,
          freezeAuthority: false,
          ageMinutes: 10,
        },
        'yolo'
      );

      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('Liquidity');
    });

    it('blocks token with too few holders', () => {
      const result = checkYoloEntryCriteria(
        {
          liquidityUsd: 100_000,
          uniqueHolders: 50, // Too few
          topHolderPercent: 10,
          devHoldingPercent: 5,
          mintAuthority: false,
          freezeAuthority: false,
          ageMinutes: 10,
        },
        'yolo'
      );

      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('holders');
    });

    it('blocks token with whale ownership', () => {
      const result = checkYoloEntryCriteria(
        {
          liquidityUsd: 100_000,
          uniqueHolders: 500,
          topHolderPercent: 25, // Too concentrated
          devHoldingPercent: 5,
          mintAuthority: false,
          freezeAuthority: false,
          ageMinutes: 10,
        },
        'yolo'
      );

      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('whale');
    });

    it('blocks token with dev holding too much', () => {
      const result = checkYoloEntryCriteria(
        {
          liquidityUsd: 100_000,
          uniqueHolders: 500,
          topHolderPercent: 10,
          devHoldingPercent: 20, // Too much
          mintAuthority: false,
          freezeAuthority: false,
          ageMinutes: 10,
        },
        'yolo'
      );

      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('Dev');
    });

    it('blocks token with mint authority enabled', () => {
      const result = checkYoloEntryCriteria(
        {
          liquidityUsd: 100_000,
          uniqueHolders: 500,
          topHolderPercent: 10,
          devHoldingPercent: 5,
          mintAuthority: true, // Dangerous
          freezeAuthority: false,
          ageMinutes: 10,
        },
        'yolo'
      );

      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('Mint authority');
    });

    it('blocks token that is too old', () => {
      const result = checkYoloEntryCriteria(
        {
          liquidityUsd: 100_000,
          uniqueHolders: 500,
          topHolderPercent: 10,
          devHoldingPercent: 5,
          mintAuthority: false,
          freezeAuthority: false,
          ageMinutes: 45, // Too old
        },
        'yolo'
      );

      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toContain('too late');
    });

    it('skips checks in task mode', () => {
      const result = checkYoloEntryCriteria(
        {
          liquidityUsd: 10_000, // Would fail YOLO
          uniqueHolders: 50,
          topHolderPercent: 30,
          devHoldingPercent: 20,
          mintAuthority: true,
          freezeAuthority: true,
          ageMinutes: 100,
        },
        'task'
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe('checkDailyLossLimit', () => {
    it('allows trade when under daily loss limit', () => {
      const result = checkDailyLossLimit('yolo');
      expect(result.allowed).toBe(true);
    });

    it('allows trade in task mode', () => {
      const result = checkDailyLossLimit('task');
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkTradeCooldown', () => {
    it('allows first trade', () => {
      const result = checkTradeCooldown('yolo');
      expect(result.allowed).toBe(true);
    });

    it('allows trade in task mode', () => {
      const result = checkTradeCooldown('task');
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkExitTriggers', () => {
    const basePosition = {
      entryPrice: 100,
      currentPrice: 100,
      sizeUsd: 100,
      openedAt: Date.now() - 60_000, // 1 min ago
    };

    it('returns null when no trigger', () => {
      const result = checkExitTriggers(basePosition, 'yolo');
      expect(result).toBeNull();
    });

    it('triggers take profit at 30%', () => {
      const result = checkExitTriggers(
        {
          ...basePosition,
          currentPrice: 130, // +30%
        },
        'yolo'
      );

      expect(result).not.toBeNull();
      if (result) {
        expect(result.type).toBe('take_profit');
        expect('profitPercent' in result ? result.profitPercent : 0).toBe(0.3);
      }
    });

    it('triggers stop loss at 20%', () => {
      const result = checkExitTriggers(
        {
          ...basePosition,
          currentPrice: 80, // -20%
        },
        'yolo'
      );

      expect(result).not.toBeNull();
      if (result) {
        expect(result.type).toBe('stop_loss');
        expect('lossPercent' in result ? result.lossPercent : 0).toBe(0.2);
      }
    });

    it('triggers time limit after 5 minutes', () => {
      const result = checkExitTriggers(
        {
          ...basePosition,
          openedAt: Date.now() - 6 * 60 * 1000, // 6 min ago
        },
        'yolo'
      );

      expect(result).not.toBeNull();
      if (result) {
        expect(result.type).toBe('time_limit');
      }
    });

    it('returns null in task mode', () => {
      const result = checkExitTriggers(
        {
          ...basePosition,
          currentPrice: 200, // Big gain
        },
        'task'
      );

      expect(result).toBeNull();
    });
  });

  describe('DEFAULT_YOLO_RISK_LIMITS', () => {
    it('has correct default values', () => {
      expect(DEFAULT_YOLO_RISK_LIMITS.maxSingleTradeUsd).toBe(50);
      expect(DEFAULT_YOLO_RISK_LIMITS.maxDailyVolumeUsd).toBe(500);
      expect(DEFAULT_YOLO_RISK_LIMITS.maxConcurrentPositions).toBe(3);
      expect(DEFAULT_YOLO_RISK_LIMITS.maxDailyLossUsd).toBe(100);
      expect(DEFAULT_YOLO_RISK_LIMITS.minLiquidityUsd).toBe(50_000);
      expect(DEFAULT_YOLO_RISK_LIMITS.maxHoldTimeSeconds).toBe(300);
      expect(DEFAULT_YOLO_RISK_LIMITS.takeProfitPercent).toBe(0.3);
      expect(DEFAULT_YOLO_RISK_LIMITS.stopLossPercent).toBe(0.2);
      expect(DEFAULT_YOLO_RISK_LIMITS.tradeCooldownSeconds).toBe(60);
    });
  });
});

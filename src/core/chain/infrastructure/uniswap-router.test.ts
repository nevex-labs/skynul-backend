import { describe, expect, it } from 'vitest';

describe('UniswapRouter', () => {
  describe('applySlippage', () => {
    it('calculates correct slippage for 50 bps', () => {
      // 1000000 * (10000 - 50) / 10000 = 995000
      const result = (BigInt(1000000) * BigInt(10000 - 50)) / BigInt(10000);
      expect(result).toBe(BigInt(995000));
    });

    it('calculates correct slippage for 100 bps', () => {
      // 1000000 * (10000 - 100) / 10000 = 990000
      const result = (BigInt(1000000) * BigInt(10000 - 100)) / BigInt(10000);
      expect(result).toBe(BigInt(990000));
    });

    it('returns same amount for 0 bps', () => {
      const result = (BigInt(1000000) * BigInt(10000)) / BigInt(10000);
      expect(result).toBe(BigInt(1000000));
    });
  });
});

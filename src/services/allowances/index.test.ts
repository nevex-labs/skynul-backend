import { Effect } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateFee, calculateNetAmount } from './fee-config';
import { AllowanceServiceTest } from './layer';
import { AllowanceService } from './tag';

describe('allowances fee-config', () => {
  describe('calculateFee', () => {
    it('should calculate 1% fee correctly', () => {
      const amount = BigInt(1000000000); // 1000 USDC (6 decimals)
      const fee = calculateFee(amount);
      expect(fee).toBe(BigInt(10000000)); // 10 USDC
    });

    it('should handle zero', () => {
      expect(calculateFee(BigInt(0))).toBe(BigInt(0));
    });
  });

  describe('calculateNetAmount', () => {
    it('should return net amount after fee', () => {
      const amount = BigInt(1000000000); // 1000 USDC
      const netAmount = calculateNetAmount(amount);
      expect(netAmount).toBe(BigInt(990000000)); // 990 USDC
    });
  });
});

describe('AllowanceService', () => {
  const TEST_USER_ID = 1;
  const TEST_TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base
  const TEST_CHAIN_ID = 8453;

  describe('checkAllowance', () => {
    it('should return sufficient in test mode', async () => {
      const program = Effect.gen(function* () {
        const svc = yield* AllowanceService;
        return yield* svc.checkAllowance(TEST_USER_ID, TEST_TOKEN, TEST_CHAIN_ID, BigInt(1000000));
      });

      const result = await Effect.runPromise(Effect.provide(program, AllowanceServiceTest));

      expect(result.sufficient).toBe(true);
    });
  });

  describe('getRemainingAllowance', () => {
    it('should return test value', async () => {
      const program = Effect.gen(function* () {
        const svc = yield* AllowanceService;
        return yield* svc.getRemainingAllowance(TEST_USER_ID, TEST_TOKEN, TEST_CHAIN_ID);
      });

      const result = await Effect.runPromise(Effect.provide(program, AllowanceServiceTest));

      expect(result).toBe(BigInt(1000000000));
    });
  });
});

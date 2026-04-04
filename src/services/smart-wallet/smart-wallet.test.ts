import { Effect } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';
import { SmartWalletServiceTest } from './layer';
import { SmartWalletService } from './tag';

describe('SmartWalletService', () => {
  describe('getOrCreateSmartAccount', () => {
    it('returns smart account address in test mode', async () => {
      const program = Effect.gen(function* () {
        const svc = yield* SmartWalletService;
        return yield* svc.getOrCreateSmartAccount(1, 8453);
      });

      const result = await Effect.runPromise(Effect.provide(program, SmartWalletServiceTest));
      expect(result).toBe('0xSmartAccount123');
    });
  });

  describe('createSessionKey', () => {
    it('returns session key with limits', async () => {
      const program = Effect.gen(function* () {
        const svc = yield* SmartWalletService;
        return yield* svc.createSessionKey(1, 8453, {
          maxPerTrade: BigInt(50000000),
          dailyLimit: BigInt(200000000),
          expiresAt: Date.now() + 86400000,
          allowedTokens: ['0xUSDC'],
        });
      });

      const result = await Effect.runPromise(Effect.provide(program, SmartWalletServiceTest));
      expect(result.maxPerTrade).toBe(BigInt(50000000));
      expect(result.dailyLimit).toBe(BigInt(200000000));
      expect(result.allowedTokens).toContain('0xUSDC');
    });
  });

  describe('revokeSessionKey', () => {
    it('revokes without error', async () => {
      const program = Effect.gen(function* () {
        const svc = yield* SmartWalletService;
        return yield* svc.revokeSessionKey(1, 8453);
      });

      await expect(Effect.runPromise(Effect.provide(program, SmartWalletServiceTest))).resolves.toBeUndefined();
    });
  });
});

import { Effect } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';
import { SwapServiceTest } from './layer';
import { SwapService } from './tag';

describe('SwapService', () => {
  describe('executeSwap', () => {
    it('executes swap and returns trade result', async () => {
      const program = Effect.gen(function* () {
        const svc = yield* SwapService;
        return yield* svc.executeSwap({
          userId: 1,
          chainId: 8453,
          tokenIn: '0xUSDC',
          tokenOut: '0xWETH',
          amountIn: BigInt(100000000), // 100 USDC
          minAmountOut: BigInt(0),
          slippageBps: 50,
        });
      });

      const result = await Effect.runPromise(Effect.provide(program, SwapServiceTest));
      expect(result.status).toBe('success');
      expect(result.amountIn).toBe(BigInt(100000000));
      expect(result.feeAmount).toBe(BigInt(1000000)); // 1%
    });
  });

  describe('getPriceQuote', () => {
    it('returns quote with route', async () => {
      const program = Effect.gen(function* () {
        const svc = yield* SwapService;
        return yield* svc.getPriceQuote(8453, '0xUSDC', '0xWETH', BigInt(100000000));
      });

      const result = await Effect.runPromise(Effect.provide(program, SwapServiceTest));
      expect(result.amountOut).toBe(BigInt(100000000));
      expect(result.route).toEqual(['0xUSDC', '0xWETH']);
      expect(result.gasEstimate).toBe(BigInt(185_000));
    });
  });

  describe('getTradeHistory', () => {
    it('returns empty array for new user', async () => {
      const program = Effect.gen(function* () {
        const svc = yield* SwapService;
        return yield* svc.getTradeHistory(999);
      });

      const result = await Effect.runPromise(Effect.provide(program, SwapServiceTest));
      expect(result).toEqual([]);
    });
  });
});

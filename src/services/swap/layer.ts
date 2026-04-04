/**
 * SwapService Live implementation.
 *
 * Orchestrates the full swap flow using infrastructure adapters.
 * This is the core business logic for AA trading.
 */

import { Effect, Layer } from 'effect';
import type { SwapIntent, TradeResult } from '../../core/chain/domain';
import { createBundler, createPaymaster, createSwapRouter } from '../../core/chain/infrastructure';
import { DatabaseError } from '../../shared/errors';
import { calculateFee } from '../allowances/fee-config';
import { AllowanceService } from '../allowances/tag';
import { DatabaseService } from '../database/tag';
import { SmartWalletService } from '../smart-wallet/tag';
import type { Quote, QuoteError, SwapError, SwapServiceApi } from './tag';
import { SwapService } from './tag';

// In-memory trade history for MVP — replace with DB table in production
const tradeHistory = new Map<number, Array<TradeResult & { chainId: number }>>();

function toSwapError(e: QuoteError | SwapError): SwapError {
  if (e._tag === 'SwapError') return e;
  return { _tag: 'SwapError', message: e.message, reason: (e as QuoteError & { reason?: string }).reason };
}

export const SwapServiceLive = Layer.effect(
  SwapService,
  Effect.gen(function* () {
    yield* DatabaseService;
    const allowance = yield* AllowanceService;
    const smartWallet = yield* SmartWalletService;

    const service: SwapServiceApi = {
      executeSwap: (intent) =>
        Effect.gen(function* () {
          // Step 1: Check allowance
          const allowanceCheck = yield* allowance.checkAllowance(
            intent.userId,
            intent.tokenIn,
            intent.chainId,
            intent.amountIn
          );

          if (!allowanceCheck.sufficient) {
            return yield* Effect.fail({
              _tag: 'SwapError' as const,
              message: 'Insufficient allowance',
              reason: `Available: ${allowanceCheck.available}, Required: ${allowanceCheck.required}`,
            });
          }

          // Step 2: Get price quote
          const quote = yield* service
            .getPriceQuote(intent.chainId, intent.tokenIn, intent.tokenOut, intent.amountIn)
            .pipe(Effect.mapError(toSwapError));

          // Step 3: Calculate fee
          const feeAmount = calculateFee(intent.amountIn);
          const netAmount = intent.amountIn - feeAmount;

          // Step 4: Get Smart Account address
          const smartAccountAddress = yield* smartWallet.getOrCreateSmartAccount(intent.userId, intent.chainId);

          // Step 5: Encode swap call
          const swapRouter = createSwapRouter(intent.chainId);
          const encodedSwap = yield* Effect.tryPromise({
            try: () =>
              swapRouter.encodeSwap({
                chainId: intent.chainId,
                tokenIn: intent.tokenIn,
                tokenOut: intent.tokenOut,
                amountIn: netAmount,
                slippageBps: intent.slippageBps,
              }),
            catch: (error) =>
              ({
                _tag: 'SwapError' as const,
                message: 'Failed to encode swap',
                reason: String(error),
              }) as SwapError,
          });

          // Step 6: Get paymaster data
          const paymaster = createPaymaster(intent.chainId);
          const paymasterData = yield* Effect.tryPromise({
            try: () =>
              paymaster.getPaymasterData({
                sender: smartAccountAddress,
                nonce: BigInt(0),
                initCode: '0x',
                callData: encodedSwap.data,
                callGasLimit: quote.gasEstimate,
                verificationGasLimit: BigInt(500_000),
                preVerificationGas: BigInt(100_000),
                maxFeePerGas: BigInt(1_000_000_000),
                maxPriorityFeePerGas: BigInt(1_000_000_000),
                paymasterAndData: '0x',
                signature: '0x',
              }),
            catch: (error) =>
              ({
                _tag: 'SwapError' as const,
                message: 'Failed to get paymaster data',
                reason: String(error),
              }) as SwapError,
          });

          // Step 7: Send UserOperation
          const bundler = createBundler(intent.chainId);
          const userOpHash = yield* Effect.tryPromise({
            try: () =>
              bundler.sendUserOperation({
                sender: smartAccountAddress,
                nonce: BigInt(0),
                initCode: '0x',
                callData: encodedSwap.data,
                callGasLimit: quote.gasEstimate,
                verificationGasLimit: BigInt(500_000),
                preVerificationGas: BigInt(100_000),
                maxFeePerGas: BigInt(1_000_000_000),
                maxPriorityFeePerGas: BigInt(1_000_000_000),
                paymasterAndData: `${paymasterData.paymaster}${paymasterData.paymasterData.slice(2)}`,
                signature: '0x',
              }),
            catch: (error) =>
              ({
                _tag: 'SwapError' as const,
                message: 'Failed to send UserOperation',
                reason: String(error),
              }) as SwapError,
          });

          // Step 8: Record allowance usage
          yield* allowance.recordUsage(intent.userId, intent.tokenIn, intent.chainId, netAmount, feeAmount);

          // Step 9: Build and store trade result
          const tradeResult: TradeResult & { chainId: number } = {
            txHash: `0xpending-${userOpHash}`,
            userOpHash,
            amountIn: intent.amountIn,
            amountOut: quote.amountOut,
            feeAmount,
            gasCostUsd: BigInt(0),
            status: 'success',
            timestamp: Date.now(),
            chainId: intent.chainId,
          };

          const userTrades = tradeHistory.get(intent.userId) ?? [];
          userTrades.push(tradeResult);
          tradeHistory.set(intent.userId, userTrades);

          return tradeResult;
        }),

      getPriceQuote: (chainId, tokenIn, tokenOut, amountIn) =>
        Effect.tryPromise({
          try: async () => {
            const router = createSwapRouter(chainId);
            return await router.getQuote({
              chainId,
              tokenIn,
              tokenOut,
              amountIn,
              slippageBps: 50,
            });
          },
          catch: (error) =>
            ({
              _tag: 'QuoteError' as const,
              message: 'Failed to get quote',
              reason: String(error),
            }) as QuoteError,
        }),

      getTradeHistory: (userId, chainId) =>
        Effect.sync(() => {
          const trades = tradeHistory.get(userId) ?? [];
          if (chainId) {
            return trades.filter((t) => t.chainId === chainId);
          }
          return trades;
        }),
    };

    return SwapService.of(service);
  })
);

// Test layer
export const SwapServiceTest = Layer.succeed(
  SwapService,
  SwapService.of({
    executeSwap: (intent) =>
      Effect.succeed({
        txHash: '0xmock-tx-hash',
        userOpHash: '0xmock-userop-hash',
        amountIn: intent.amountIn,
        amountOut: intent.amountIn,
        feeAmount: calculateFee(intent.amountIn),
        gasCostUsd: BigInt(0),
        status: 'success' as const,
        timestamp: Date.now(),
      }),
    getPriceQuote: (_chainId, _tokenIn, _tokenOut, amountIn) =>
      Effect.succeed({
        amountOut: amountIn,
        priceImpact: 0,
        route: [_tokenIn, _tokenOut],
        gasEstimate: BigInt(185_000),
      }),
    getTradeHistory: () => Effect.succeed([]),
  })
);

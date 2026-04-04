/**
 * SwapService — Effect.js service for executing token swaps via AA.
 *
 * Orchestrates the full swap flow:
 * 1. Check allowance
 * 2. Get price quote
 * 3. Deduct fee
 * 4. Execute swap via UserOperation
 * 5. Record trade history
 */

import { Context, Effect } from 'effect';
import type { SwapIntent, TradeResult } from '../../core/chain/domain';
import { DatabaseError } from '../../shared/errors';

export interface SwapError {
  readonly _tag: 'SwapError';
  readonly message: string;
  readonly reason?: string;
}

export interface QuoteError {
  readonly _tag: 'QuoteError';
  readonly message: string;
}

export interface Quote {
  amountOut: bigint;
  priceImpact: number;
  route: string[];
  gasEstimate: bigint;
}

export interface SwapServiceApi {
  /**
   * Execute a full swap: check allowance → quote → execute → record.
   * Returns the trade result with amounts and fees.
   */
  readonly executeSwap: (intent: SwapIntent) => Effect.Effect<TradeResult, SwapError | DatabaseError, never>;

  /**
   * Get a price quote for a swap without executing.
   */
  readonly getPriceQuote: (
    chainId: number,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ) => Effect.Effect<Quote, QuoteError, never>;

  /**
   * Get trade history for a user.
   */
  readonly getTradeHistory: (userId: number, chainId?: number) => Effect.Effect<TradeResult[], DatabaseError, never>;
}

export class SwapService extends Context.Tag('SwapService')<SwapService, SwapServiceApi>() {}

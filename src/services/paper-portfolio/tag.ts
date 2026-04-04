import { Context, Effect } from 'effect';
import type {
  PaperBalanceDto,
  PaperPortfolioSummary,
  PaperPosition,
  PaperTradeDto,
  PaperTradeInput,
  SwapSimulationParams,
  SwapSimulationResult,
} from '../../infrastructure/db/schema/paper-portfolio';
import { DatabaseError } from '../../shared/errors';

export interface PaperPortfolioServiceApi {
  /**
   * Get balance for a single asset.
   * Auto-seeds portfolio with 10k USDC on first call if no balances exist.
   */
  readonly getBalance: (userId: number, asset: string) => Effect.Effect<number, DatabaseError>;

  /**
   * Get all balances with amount > 0.
   */
  readonly getBalances: (userId: number) => Effect.Effect<PaperBalanceDto[], DatabaseError>;

  /**
   * Adjust balance by delta (positive = add, negative = subtract).
   */
  readonly adjustBalance: (userId: number, asset: string, delta: number) => Effect.Effect<void, DatabaseError>;

  /**
   * Record a paper trade. Returns the generated orderId.
   */
  readonly recordTrade: (userId: number, input: PaperTradeInput) => Effect.Effect<string, DatabaseError>;

  /**
   * Get paper trades, optionally filtered by venue and/or limited.
   */
  readonly getTrades: (
    userId: number,
    opts?: { venue?: string; limit?: number }
  ) => Effect.Effect<PaperTradeDto[], DatabaseError>;

  /**
   * Summarize the paper portfolio.
   */
  readonly getSummary: (userId: number) => Effect.Effect<PaperPortfolioSummary, DatabaseError>;

  /**
   * Reset the paper portfolio to a fresh state.
   */
  readonly resetPortfolio: (userId: number, startingUsdc?: number) => Effect.Effect<void, DatabaseError>;

  /**
   * Get paper positions computed from trade history.
   */
  readonly getPositions: (userId: number, venue?: string) => Effect.Effect<PaperPosition[], DatabaseError>;

  /**
   * Simulate a realistic DEX swap with slippage, price impact, fees, and gas.
   */
  readonly simulateSwap: (params: SwapSimulationParams) => Effect.Effect<SwapSimulationResult, DatabaseError>;

  /**
   * Record a realistic paper swap with full cost breakdown.
   */
  readonly recordSwap: (
    userId: number,
    taskId: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    chainId?: 'base' | 'ethereum' | 'solana'
  ) => Effect.Effect<SwapSimulationResult & { orderId: string }, DatabaseError>;
}

export class PaperPortfolioService extends Context.Tag('PaperPortfolioService')<
  PaperPortfolioService,
  PaperPortfolioServiceApi
>() {}

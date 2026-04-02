/**
 * Trading Cost Simulation - Domain Layer
 *
 * Clean Architecture: Interfaces/Ports que definen el comportamiento
 * sin depender de implementaciones concretas.
 */

// ── Domain Types ─────────────────────────────────────────────────────────────

export interface ChainConfig {
  chainId: 'base' | 'ethereum' | 'solana';
  name: string;
  nativeToken: string;
}

export interface TokenProfile {
  address: string;
  symbol: string;
  category: 'stablecoin' | 'major' | 'altcoin' | 'meme';
  typicalLiquidityUsd: number;
}

export interface TradeParameters {
  amountIn: number;
  tokenIn: TokenProfile;
  tokenOut: TokenProfile;
  chain: ChainConfig;
  urgency: 'low' | 'medium' | 'high'; // Affects gas price
}

export interface CostBreakdown {
  gasCostUsd: number;
  dexFeeUsd: number;
  slippageUsd: number;
  priceImpactUsd: number;
  mevRiskUsd: number;
  failedTxRiskUsd: number;
  totalCostUsd: number;
  totalCostPercent: number;
  expectedOutput: number;
  details: CostDetail[];
}

export interface CostDetail {
  type: string;
  amountUsd: number;
  percent: number;
  description: string;
}

// ── Ports/Interfaces ──────────────────────────────────────────────────────────

/**
 * Port: Gas estimation for different chains
 */
export interface IGasEstimator {
  estimateGasUsd(chain: ChainConfig, urgency: string): number;
  getBaseGasGwei(chain: ChainConfig): number;
}

/**
 * Port: DEX fee calculation based on token type
 */
export interface IDexFeeCalculator {
  calculateFee(tokenIn: TokenProfile, tokenOut: TokenProfile): number;
  getFeeTier(token: TokenProfile): number;
}

/**
 * Port: Slippage calculation based on liquidity
 */
export interface ISlippageCalculator {
  calculateSlippage(tradeUsd: number, liquidityUsd: number): number;
  getSlippageRange(tradeUsd: number, liquidityUsd: number): { min: number; max: number };
}

/**
 * Port: Price impact based on trade size
 */
export interface IPriceImpactCalculator {
  calculateImpact(tradeUsd: number, liquidityUsd: number): number;
}

/**
 * Port: MEV risk estimation
 */
export interface IMevRiskEstimator {
  estimateRisk(token: TokenProfile, amountUsd: number): { probability: number; expectedLoss: number };
}

/**
 * Port: Market data provider (external dependency)
 */
export interface IMarketDataProvider {
  getLiquidity(tokenAddress: string, chain: ChainConfig): Promise<number>;
  getPrice(tokenAddress: string, chain: ChainConfig): Promise<number>;
}

/**
 * Port: Trading cost simulator (orchestrator)
 */
export interface ITradingCostSimulator {
  simulateCosts(params: TradeParameters): Promise<CostBreakdown>;
  simulateWithLiquidity(params: TradeParameters, liquidityUsd: number): CostBreakdown;
}

// ── Configuration Types ───────────────────────────────────────────────────────

export interface SimulationConfig {
  chains: Record<string, ChainConfig>;
  defaultGasEstimator: IGasEstimator;
  defaultDexFeeCalculator: IDexFeeCalculator;
  defaultSlippageCalculator: ISlippageCalculator;
  defaultPriceImpactCalculator: IPriceImpactCalculator;
  defaultMevRiskEstimator: IMevRiskEstimator;
  marketDataProvider?: IMarketDataProvider;
  enableDebugLogs: boolean;
}

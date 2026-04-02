/**
 * Trading Cost Simulator - Application Layer
 *
 * Orquestador que combina todos los componentes para simular
 * costos de trading de manera realista.
 *
 * Clean Architecture: Depende de abstracciones (interfaces), no de implementaciones.
 */

import type {
  ChainConfig,
  CostBreakdown,
  CostDetail,
  IDexFeeCalculator,
  IGasEstimator,
  IMarketDataProvider,
  IMevRiskEstimator,
  IPriceImpactCalculator,
  ISlippageCalculator,
  ITradingCostSimulator,
  TokenProfile,
  TradeParameters,
} from './types';

export interface SimulatorDependencies {
  gasEstimator: IGasEstimator;
  dexFeeCalculator: IDexFeeCalculator;
  slippageCalculator: ISlippageCalculator;
  priceImpactCalculator: IPriceImpactCalculator;
  mevRiskEstimator: IMevRiskEstimator;
  marketDataProvider?: IMarketDataProvider;
  enableDebugLogs?: boolean;
}

export class TradingCostSimulator implements ITradingCostSimulator {
  private deps: SimulatorDependencies;

  constructor(dependencies: SimulatorDependencies) {
    this.deps = dependencies;
  }

  async simulateCosts(params: TradeParameters): Promise<CostBreakdown> {
    // Get real liquidity from market data provider if available
    let liquidityUsd = this.estimateLiquidity(params.tokenOut);

    if (this.deps.marketDataProvider) {
      try {
        liquidityUsd = await this.deps.marketDataProvider.getLiquidity(params.tokenOut.address, params.chain);
      } catch (error) {
        this.logDebug('Failed to fetch liquidity, using estimate:', error);
      }
    }

    return this.simulateWithLiquidity(params, liquidityUsd);
  }

  simulateWithLiquidity(params: TradeParameters, liquidityUsd: number): CostBreakdown {
    const { amountIn, tokenIn, tokenOut, chain, urgency } = params;
    const details: CostDetail[] = [];

    // 1. Gas Cost (Real from Etherscan)
    const gasCostUsd = this.deps.gasEstimator.estimateGasUsd(chain, urgency);
    details.push({
      type: 'gas',
      amountUsd: gasCostUsd,
      percent: (gasCostUsd / amountIn) * 100,
      description: `Gas fee on ${chain.name} (${urgency} urgency)`,
    });

    // 2. DEX Fee (Real from Uniswap docs)
    const dexFeePercent = this.deps.dexFeeCalculator.calculateFee(tokenIn, tokenOut);
    const dexFeeUsd = amountIn * (dexFeePercent / 100);
    details.push({
      type: 'dex_fee',
      amountUsd: dexFeeUsd,
      percent: dexFeePercent,
      description: `DEX fee (${dexFeePercent}% tier)`,
    });

    // 3. Slippage (Based on Coinbase/Chainlink research)
    const slippagePercent = this.deps.slippageCalculator.calculateSlippage(amountIn, liquidityUsd);
    const slippageUsd = amountIn * (slippagePercent / 100);
    details.push({
      type: 'slippage',
      amountUsd: slippageUsd,
      percent: slippagePercent,
      description: `Slippage (${slippagePercent.toFixed(2)}%) based on $${liquidityUsd.toLocaleString()} liquidity`,
    });

    // 4. Price Impact (Uniswap V3 formula)
    const impactPercent = this.deps.priceImpactCalculator.calculateImpact(amountIn, liquidityUsd);
    const impactUsd = amountIn * (impactPercent / 100);
    details.push({
      type: 'price_impact',
      amountUsd: impactUsd,
      percent: impactPercent,
      description: `Price impact (${impactPercent.toFixed(2)}%) on pool`,
    });

    // 5. MEV Risk (Probabilistic)
    const mevRisk = this.deps.mevRiskEstimator.estimateRisk(tokenOut, amountIn);
    const mevRiskUsd = amountIn * ((mevRisk.probability * mevRisk.expectedLoss) / 100);
    details.push({
      type: 'mev_risk',
      amountUsd: mevRiskUsd,
      percent: mevRisk.probability * mevRisk.expectedLoss,
      description: `MEV risk (${(mevRisk.probability * 100).toFixed(0)}% chance of ${mevRisk.expectedLoss}% loss)`,
    });

    // 6. Failed Transaction Risk (5% probability, lose gas)
    const FAILED_TX_RATE = 0.05;
    const failedTxRiskUsd = gasCostUsd * FAILED_TX_RATE;
    details.push({
      type: 'failed_tx_risk',
      amountUsd: failedTxRiskUsd,
      percent: (failedTxRiskUsd / amountIn) * 100,
      description: `Failed tx risk (${(FAILED_TX_RATE * 100).toFixed(0)}% probability)`,
    });

    // Calculate totals
    const totalCostUsd = gasCostUsd + dexFeeUsd + slippageUsd + impactUsd + mevRiskUsd + failedTxRiskUsd;
    const totalCostPercent = (totalCostUsd / amountIn) * 100;
    const expectedOutput = amountIn - totalCostUsd;

    const result: CostBreakdown = {
      gasCostUsd,
      dexFeeUsd,
      slippageUsd,
      priceImpactUsd: impactUsd,
      mevRiskUsd,
      failedTxRiskUsd,
      totalCostUsd,
      totalCostPercent,
      expectedOutput,
      details,
    };

    this.logDebug('Trading cost simulation:', result);
    return result;
  }

  private estimateLiquidity(token: TokenProfile): number {
    // Fallback estimates when market data is unavailable
    const estimates: Record<string, number> = {
      stablecoin: 1_000_000, // $1M for stables
      major: 2_000_000, // $2M for ETH, BTC
      altcoin: 500_000, // $500K for alts
      meme: 100_000, // $100K for memes
    };
    return estimates[token.category] ?? 250_000;
  }

  private logDebug(message: string, data?: unknown): void {
    if (this.deps.enableDebugLogs) {
      console.log(`[TradingCostSimulator] ${message}`, data ?? '');
    }
  }
}

// ── Convenience Factory ───────────────────────────────────────────────────────

import { createRealTradingCostComponents } from './implementations';

export function createRealisticTradingSimulator(
  marketDataProvider?: IMarketDataProvider,
  enableDebugLogs = false
): TradingCostSimulator {
  const components = createRealTradingCostComponents();

  return new TradingCostSimulator({
    ...components,
    marketDataProvider,
    enableDebugLogs,
  });
}

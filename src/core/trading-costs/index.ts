/**
 * Trading Costs Module - Clean Architecture
 *
 * Módulo para simular costos de trading de manera realista.
 *
 * Architecture:
 * - Domain Layer: types.ts (interfaces, entidades)
 * - Application Layer: simulator.ts (orquestador)
 * - Infrastructure Layer: implementations.ts (datos reales del mercado)
 *
 * Usage:
 * ```typescript
 * import { createRealisticTradingSimulator, TOKEN_PROFILES, CHAIN_CONFIGS } from './trading-costs';
 *
 * const simulator = createRealisticTradingSimulator();
 * const costs = await simulator.simulateCosts({
 *   amountIn: 100,
 *   tokenIn: TOKEN_PROFILES.USDC,
 *   tokenOut: TOKEN_PROFILES.PEPE,
 *   chain: CHAIN_CONFIGS.BASE,
 *   urgency: 'medium',
 * });
 *
 * console.log(`Total cost: ${costs.totalCostPercent.toFixed(2)}%`);
 * console.log(`Expected output: $${costs.expectedOutput.toFixed(2)}`);
 * ```
 */

// Domain Layer
export * from './types';

// Application Layer
export { TradingCostSimulator, createRealisticTradingSimulator } from './simulator';

// Infrastructure Layer
export {
  RealGasEstimator,
  RealDexFeeCalculator,
  RealSlippageCalculator,
  RealPriceImpactCalculator,
  RealMevRiskEstimator,
  createRealTradingCostComponents,
} from './implementations';

// ── Predefined Configurations ─────────────────────────────────────────────────

import type { ChainConfig, TokenProfile } from './types';

export const CHAIN_CONFIGS = {
  BASE: {
    chainId: 'base',
    name: 'Base',
    nativeToken: 'ETH',
  } as ChainConfig,

  ETHEREUM: {
    chainId: 'ethereum',
    name: 'Ethereum',
    nativeToken: 'ETH',
  } as ChainConfig,

  SOLANA: {
    chainId: 'solana',
    name: 'Solana',
    nativeToken: 'SOL',
  } as ChainConfig,
} as const;

export const TOKEN_PROFILES = {
  USDC: {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base USDC
    symbol: 'USDC',
    category: 'stablecoin',
    typicalLiquidityUsd: 1_000_000,
  } as TokenProfile,

  USDT: {
    address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', // Base USDT
    symbol: 'USDT',
    category: 'stablecoin',
    typicalLiquidityUsd: 800_000,
  } as TokenProfile,

  ETH: {
    address: '0x4200000000000000000000000000000000000006', // Base WETH
    symbol: 'ETH',
    category: 'major',
    typicalLiquidityUsd: 2_000_000,
  } as TokenProfile,

  WBTC: {
    address: '0x1ceA8420b47aF0bE9b17502477d35109bB31c1Be',
    symbol: 'WBTC',
    category: 'major',
    typicalLiquidityUsd: 1_500_000,
  } as TokenProfile,

  PEPE: {
    address: '0x1234567890123456789012345678901234567890', // Placeholder
    symbol: 'PEPE',
    category: 'meme',
    typicalLiquidityUsd: 150_000,
  } as TokenProfile,

  SHIB: {
    address: '0x2345678901234567890123456789012345678901',
    symbol: 'SHIB',
    category: 'meme',
    typicalLiquidityUsd: 200_000,
  } as TokenProfile,

  // Generic tokens for dynamic use
  UNKNOWN: {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'UNKNOWN',
    category: 'altcoin',
    typicalLiquidityUsd: 250_000,
  } as TokenProfile,
} as const;

/**
 * Helper to detect token category from symbol
 */
export function detectTokenCategory(symbol: string): TokenProfile['category'] {
  const upper = symbol.toUpperCase();

  if (['USDC', 'USDT', 'DAI', 'USDE'].includes(upper)) {
    return 'stablecoin';
  }

  if (['ETH', 'WETH', 'BTC', 'WBTC'].includes(upper)) {
    return 'major';
  }

  if (['PEPE', 'SHIB', 'DOGE', 'FLOKI', 'BONK', 'WIF', 'BOME'].includes(upper)) {
    return 'meme';
  }

  return 'altcoin';
}

/**
 * Create a token profile from symbol and address
 */
export function createTokenProfile(symbol: string, address: string): TokenProfile {
  const category = detectTokenCategory(symbol);

  const liquidityMap: Record<TokenProfile['category'], number> = {
    stablecoin: 1_000_000,
    major: 2_000_000,
    altcoin: 500_000,
    meme: 100_000,
  };

  return {
    address,
    symbol: symbol.toUpperCase(),
    category,
    typicalLiquidityUsd: liquidityMap[category],
  };
}

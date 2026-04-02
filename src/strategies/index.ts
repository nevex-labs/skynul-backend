/**
 * Trading Strategies — Configurable trading bots
 *
 * Strategies:
 * - MemeMomentum: Buy trending tokens with social velocity
 * - DipBuyer: Buy dips of established tokens
 * - NewLaunch: Scalp new token launches
 */

// NOTE: These will be imported from providers when implemented
// For now, we define minimal interfaces to avoid circular dependencies
interface MarketDataProvider {
  getTrendingTokens(limit?: number): Promise<any[]>;
  getNewLaunches(minutes?: number): Promise<any[]>;
  getPrice(token: string): Promise<{ priceUsd: number; symbol: string; priceChange24h: number }>;
  getTokenInfo(token: string): Promise<any>;
}

interface WalletProvider {
  getBalance(): Promise<any>;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface StrategyContext {
  marketData: MarketDataProvider;
  wallet: WalletProvider;
  portfolio: {
    totalValueUsd: number;
    positions: Map<string, { sizeUsd: number; entryPrice: number }>;
  };
  config: {
    maxPositionSizeUsd: number;
    takeProfitPercent: number;
    stopLossPercent: number;
  };
}

export interface StrategyEvaluation {
  shouldExecute: boolean;
  confidence: number; // 0-1
  reason: string;
  actions: any[];
}

export interface TradingStrategy {
  id: string;
  name: string;
  description: string;

  evaluate(context: StrategyContext): Promise<StrategyEvaluation>;
}

// ── Meme Momentum Strategy ───────────────────────────────────────────────────

export const memeMomentumStrategy: TradingStrategy = {
  id: 'meme-momentum',
  name: 'Meme Coin Momentum',
  description: 'Buy trending meme coins with high social velocity and price momentum',

  async evaluate(context: StrategyContext): Promise<StrategyEvaluation> {
    try {
      // Get trending tokens
      const trending = await context.marketData.getTrendingTokens(20);

      // Filter for meme coins with momentum
      const opportunities = trending.filter((token: any) => {
        // Must be up significantly
        if (token.priceChange24h < 20) return false;

        // Must have good volume
        if (token.volume24h < 100_000) return false;

        // Must have liquidity
        if (token.liquidityUsd < 50_000) return false;

        return true;
      });

      if (opportunities.length === 0) {
        return {
          shouldExecute: false,
          confidence: 0,
          reason: 'No trending meme coins found',
          actions: [],
        };
      }

      // Pick the best opportunity (highest momentum)
      const best = opportunities[0];

      // Calculate position size
      const positionSize = Math.min(
        context.config.maxPositionSizeUsd,
        context.portfolio.totalValueUsd * 0.05 // 5% max
      );

      // Check if we already have this position
      if (context.portfolio.positions.has(best.token)) {
        return {
          shouldExecute: false,
          confidence: 0,
          reason: 'Already have position in ' + best.symbol,
          actions: [],
        };
      }

      return {
        shouldExecute: true,
        confidence: Math.min(best.priceChange24h / 100, 0.9),
        reason: `${best.symbol} trending: +${best.priceChange24h.toFixed(1)}% with $${(best.volume24h / 1000).toFixed(0)}k volume`,
        actions: [
          {
            type: 'market_buy',
            token: best.token,
            amountUsd: positionSize,
          },
        ],
      };
    } catch (error) {
      return {
        shouldExecute: false,
        confidence: 0,
        reason: 'Error evaluating: ' + (error instanceof Error ? error.message : 'unknown'),
        actions: [],
      };
    }
  },
};

// ── Dip Buyer Strategy ──────────────────────────────────────────────────────

export const dipBuyerStrategy: TradingStrategy = {
  id: 'dip-buyer',
  name: 'Dip Buyer',
  description: 'Buy established tokens when they dip >20%',

  async evaluate(context: StrategyContext): Promise<StrategyEvaluation> {
    // List of established tokens to watch
    const watchList = [
      { token: 'ETH', symbol: 'ETH', minMarketCap: 1_000_000_000 },
      { token: 'BTC', symbol: 'BTC', minMarketCap: 1_000_000_000_000 },
    ];

    for (const coin of watchList) {
      try {
        const info = await context.marketData.getPrice(coin.token);

        // Check for dip
        if (info.priceChange24h < -20) {
          // Calculate position size
          const positionSize = Math.min(
            context.config.maxPositionSizeUsd,
            context.portfolio.totalValueUsd * 0.1 // 10% for dips (safer)
          );

          // Check if we already have position
          if (context.portfolio.positions.has(coin.token)) {
            continue;
          }

          return {
            shouldExecute: true,
            confidence: 0.7,
            reason: `${coin.symbol} dipped ${info.priceChange24h.toFixed(1)}% - buying opportunity`,
            actions: [
              {
                type: 'market_buy',
                token: coin.token,
                amountUsd: positionSize,
              },
            ],
          };
        }
      } catch (e) {
        // Skip on error
      }
    }

    return {
      shouldExecute: false,
      confidence: 0,
      reason: 'No significant dips found',
      actions: [],
    };
  },
};

// ── New Launch Strategy ─────────────────────────────────────────────────────

export const newLaunchStrategy: TradingStrategy = {
  id: 'new-launch',
  name: 'New Launch Hunter',
  description: 'Scalp new token launches within first 30 minutes',

  async evaluate(context: StrategyContext): Promise<StrategyEvaluation> {
    try {
      // Get new launches
      const launches = await context.marketData.getNewLaunches(30);

      // Filter for good opportunities
      const opportunities = launches.filter((token: any) => {
        // Must be very new
        if (token.ageMinutes > 30) return false;

        // Must have minimum liquidity
        if (token.liquidityUsd < 30_000) return false;

        // Must have some holders
        if (token.uniqueHolders < 50) return false;

        // Check for red flags
        if (token.mintAuthority === true) return false;
        if (token.freezeAuthority === true) return false;
        if ((token.devHoldingPercent || 0) > 15) return false;

        return true;
      });

      if (opportunities.length === 0) {
        return {
          shouldExecute: false,
          confidence: 0,
          reason: 'No suitable new launches',
          actions: [],
        };
      }

      // Pick the newest with best metrics
      const best = opportunities[0];

      // Small position (high risk)
      const positionSize = Math.min(30, context.config.maxPositionSizeUsd * 0.5);

      return {
        shouldExecute: true,
        confidence: 0.6,
        reason: `New launch ${best.symbol}: ${best.ageMinutes}min old, ${best.uniqueHolders} holders, $${(best.liquidityUsd / 1000).toFixed(0)}k liquidity`,
        actions: [
          {
            type: 'market_buy',
            token: best.address,
            amountUsd: positionSize,
          },
        ],
      };
    } catch (error) {
      return {
        shouldExecute: false,
        confidence: 0,
        reason: 'Error fetching new launches',
        actions: [],
      };
    }
  },
};

// ── Strategy Registry ────────────────────────────────────────────────────────

export const STRATEGIES: TradingStrategy[] = [memeMomentumStrategy, dipBuyerStrategy, newLaunchStrategy];

export function getStrategy(id: string): TradingStrategy | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

export function getAllStrategies(): TradingStrategy[] {
  return STRATEGIES;
}

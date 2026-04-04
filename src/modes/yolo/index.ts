/**
 * YOLO Mode Orchestrator — Autonomous trading mode
 *
 * Features:
 * - Scan market for opportunities every X seconds
 * - Evaluate strategies against market data
 * - Execute trades with risk management
 * - Monitor positions and auto-exit
 * - Track P&L and metrics
 */

import { Effect } from 'effect';
import type { MarketDataProvider } from '../../core/providers/market';
import type { WalletProvider } from '../../core/providers/wallet';
import type { TradingMode } from '../../infrastructure/db/schema/risk-guard';
import { DatabaseLive } from '../../services/database';
import { RiskGuardService, RiskGuardServiceLive } from '../../services/risk-guard';
import type { TradingSkill } from '../../skills/trading';
import type { StrategyContext, StrategyEvaluation, TradingStrategy } from '../../strategies';

// ── Types ────────────────────────────────────────────────────────────────────

export interface YoloConfig {
  mode: TradingMode;
  scanIntervalMs: number;
  strategies: string[];
  maxOpenPositions: number;
  maxPositionSizeUsd: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  maxHoldTimeMinutes: number;
  tradeCooldownMinutes: number;
  maxDailyLossUsd: number;
}

export interface YoloStatus {
  active: boolean;
  scanning: boolean;
  lastScanAt: number | null;
  positions: number;
  todayTrades: number;
  todayPnlUsd: number;
  winRate: number;
  averageHoldTime: number;
  strategyStatuses: Record<string, { lastEvaluated: number; lastAction: string }>;
}

export interface YoloMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnlUsd: number;
  averageWinUsd: number;
  averageLossUsd: number;
  largestWinUsd: number;
  largestLossUsd: number;
  bestStrategy: string;
  worstStrategy: string;
}

// Helper to run RiskGuardService effects
async function runRiskGuardEffect<T>(effect: Effect.Effect<T, unknown, RiskGuardService>): Promise<T> {
  const program = effect.pipe(Effect.provide(RiskGuardServiceLive), Effect.provide(DatabaseLive));
  return Effect.runPromise(program as Effect.Effect<T>);
}

// ── YOLO Orchestrator ────────────────────────────────────────────────────────

export class YoloOrchestrator {
  private config: YoloConfig;
  private wallet: WalletProvider;
  private marketData: MarketDataProvider;
  private tradingSkill: TradingSkill;
  private strategies: TradingStrategy[];
  private userId: number;

  private active = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private lastScanAt: number | null = null;
  private strategyStatuses: Map<string, { lastEvaluated: number; lastAction: string }> = new Map();

  // Metrics
  private todayTrades = 0;
  private todayPnlUsd = 0;
  private trades: Array<{ profit: number; strategy: string }> = [];

  constructor(
    config: YoloConfig,
    wallet: WalletProvider,
    marketData: MarketDataProvider,
    tradingSkill: TradingSkill,
    strategies: TradingStrategy[],
    userId = 0
  ) {
    this.config = config;
    this.wallet = wallet;
    this.marketData = marketData;
    this.tradingSkill = tradingSkill;
    this.strategies = strategies;
    this.userId = userId;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.active) {
      throw new Error('Yolo mode already active');
    }

    // Check daily loss limit
    const lossCheck = await runRiskGuardEffect(
      Effect.flatMap(RiskGuardService, (service) => service.checkDailyLossLimit(this.userId, 'yolo'))
    );
    if (!lossCheck.allowed) {
      throw new Error('Daily loss limit reached: ' + lossCheck.reason);
    }

    this.active = true;

    // Start scanning
    this.scanInterval = setInterval(() => {
      void this.scan();
    }, this.config.scanIntervalMs);

    // Immediate first scan
    await this.scan();

    console.log('[YOLO] Mode activated');
  }

  stop(): void {
    this.active = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    console.log('[YOLO] Mode deactivated');
  }

  // ── Main Scan Loop ──────────────────────────────────────────────────────────

  private async scan(): Promise<void> {
    if (!this.active) return;

    this.lastScanAt = Date.now();

    try {
      // Check cooldown
      const cooldownCheck = await runRiskGuardEffect(
        Effect.flatMap(RiskGuardService, (service) => service.checkTradeCooldown(this.userId, 'yolo'))
      );
      if (!cooldownCheck.allowed) {
        return; // Skip this scan
      }

      // Check daily loss limit
      const lossCheck = await runRiskGuardEffect(
        Effect.flatMap(RiskGuardService, (service) => service.checkDailyLossLimit(this.userId, 'yolo'))
      );
      if (!lossCheck.allowed) {
        console.log('[YOLO] Daily loss limit reached, stopping');
        this.stop();
        return;
      }

      // Get wallet balance
      const balance = await this.wallet.getBalance();
      const portfolioValue = Number.parseFloat(balance.balance) * (balance.balanceUsd || 1);

      // Build context
      const context: StrategyContext = {
        marketData: this.marketData,
        wallet: this.wallet,
        portfolio: {
          totalValueUsd: portfolioValue,
          positions: this.tradingSkill.getAllPositions().reduce((acc, pos) => {
            acc.set(pos.token, { sizeUsd: pos.sizeUsd, entryPrice: pos.entryPrice });
            return acc;
          }, new Map()),
        },
        config: {
          maxPositionSizeUsd: this.config.maxPositionSizeUsd,
          takeProfitPercent: this.config.takeProfitPercent,
          stopLossPercent: this.config.stopLossPercent,
        },
      };

      // Evaluate each strategy
      for (const strategy of this.strategies) {
        // Skip if too many positions
        if (this.tradingSkill.getAllPositions().length >= this.config.maxOpenPositions) {
          break;
        }

        const evaluation = await strategy.evaluate(context);

        this.strategyStatuses.set(strategy.id, {
          lastEvaluated: Date.now(),
          lastAction: evaluation.shouldExecute ? 'EXECUTE' : 'SKIP',
        });

        if (evaluation.shouldExecute && evaluation.confidence > 0.6) {
          await this.executeStrategy(strategy.id, evaluation, context);
        }
      }

      // Monitor existing positions for exits
      await this.monitorPositions();
    } catch (error) {
      console.error('[YOLO] Scan error:', error);
    }
  }

  // ── Execution ───────────────────────────────────────────────────────────────

  private async executeStrategy(
    strategyId: string,
    evaluation: StrategyEvaluation,
    context: StrategyContext
  ): Promise<void> {
    console.log(`[YOLO] Strategy ${strategyId}: ${evaluation.reason}`);

    for (const action of evaluation.actions) {
      try {
        // Validate with risk guard
        if (action.type === 'market_buy') {
          // Check entry criteria
          const tokenInfo = await this.marketData.getTokenInfo(action.token);
          const entryCheck = await runRiskGuardEffect(
            Effect.flatMap(RiskGuardService, (service) =>
              service.checkYoloEntryCriteria(
                this.userId,
                {
                  liquidityUsd: tokenInfo.liquidityUsd,
                  uniqueHolders: tokenInfo.uniqueHolders,
                  topHolderPercent: tokenInfo.topHolders[0]?.percent || 0,
                  devHoldingPercent: tokenInfo.devHoldingPercent || 0,
                  mintAuthority: tokenInfo.mintAuthority,
                  freezeAuthority: tokenInfo.freezeAuthority,
                  ageMinutes: tokenInfo.ageMinutes,
                },
                'yolo'
              )
            )
          );

          if (!entryCheck.allowed) {
            console.log(`[YOLO] Entry blocked: ${entryCheck.reason}`);
            continue;
          }
        }

        // Execute
        const result = await this.tradingSkill.execute(action);

        if (result.success) {
          this.todayTrades++;
          console.log(`[YOLO] Executed: ${action.type} ${action.token}`);
        } else {
          console.log(`[YOLO] Failed: ${result.error}`);
        }
      } catch (error) {
        console.error(`[YOLO] Execution error:`, error);
      }
    }
  }

  // ── Position Monitoring ─────────────────────────────────────────────────────

  private async monitorPositions(): Promise<void> {
    const positions = this.tradingSkill.getAllPositions();

    for (const position of positions) {
      try {
        // Update position with current price
        const price = await this.marketData.getPrice(position.token);
        const currentPrice = price.priceUsd;

        // Check exit triggers
        const exit = await runRiskGuardEffect(
          Effect.flatMap(RiskGuardService, (service) =>
            service.checkExitTriggers(
              this.userId,
              {
                entryPrice: position.entryPrice,
                currentPrice,
                sizeUsd: position.sizeUsd,
                openedAt: position.openedAt,
              },
              'yolo'
            )
          )
        );

        if (exit) {
          console.log(`[YOLO] Exit trigger: ${exit.type} for ${position.token}`);

          // Close position
          const result = await this.tradingSkill.execute({
            type: 'close_position',
            token: position.token,
            reason: exit.type,
          });

          if (result.success) {
            // Calculate P&L
            const pnlUsd = (currentPrice - position.entryPrice) * position.size;
            this.todayPnlUsd += pnlUsd;
            this.trades.push({ profit: pnlUsd, strategy: 'yolo' });
          }
        }
      } catch (error) {
        console.error(`[YOLO] Monitor error for ${position.token}:`, error);
      }
    }
  }

  // ── Status & Metrics ────────────────────────────────────────────────────────

  getStatus(): YoloStatus {
    const winningTrades = this.trades.filter((t) => t.profit > 0).length;
    const winRate = this.trades.length > 0 ? (winningTrades / this.trades.length) * 100 : 0;

    return {
      active: this.active,
      scanning: this.active && this.scanInterval !== null,
      lastScanAt: this.lastScanAt,
      positions: this.tradingSkill.getAllPositions().length,
      todayTrades: this.todayTrades,
      todayPnlUsd: this.todayPnlUsd,
      winRate,
      averageHoldTime: this.calculateAverageHoldTime(),
      strategyStatuses: Object.fromEntries(this.strategyStatuses),
    };
  }

  getMetrics(): YoloMetrics {
    const wins = this.trades.filter((t) => t.profit > 0);
    const losses = this.trades.filter((t) => t.profit <= 0);

    const totalPnl = this.trades.reduce((sum, t) => sum + t.profit, 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.profit, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.profit, 0) / losses.length : 0;

    return {
      totalTrades: this.trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      totalPnlUsd: totalPnl,
      averageWinUsd: avgWin,
      averageLossUsd: avgLoss,
      largestWinUsd: wins.length > 0 ? Math.max(...wins.map((t) => t.profit)) : 0,
      largestLossUsd: losses.length > 0 ? Math.min(...losses.map((t) => t.profit)) : 0,
      bestStrategy: 'meme-momentum',
      worstStrategy: 'dip-buyer',
    };
  }

  private calculateAverageHoldTime(): number {
    const positions = this.tradingSkill.getAllPositions();
    if (positions.length === 0) return 0;

    const now = Date.now();
    const totalMinutes = positions.reduce((sum, pos) => {
      return sum + (now - pos.openedAt) / 60000;
    }, 0);

    return totalMinutes / positions.length;
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createYoloOrchestrator(
  config: YoloConfig,
  wallet: WalletProvider,
  marketData: MarketDataProvider,
  tradingSkill: TradingSkill,
  strategies: TradingStrategy[],
  userId = 0
): YoloOrchestrator {
  return new YoloOrchestrator(config, wallet, marketData, tradingSkill, strategies, userId);
}

// ── Default Config ───────────────────────────────────────────────────────────

export const DEFAULT_YOLO_CONFIG: YoloConfig = {
  mode: 'yolo',
  scanIntervalMs: 5 * 60 * 1000, // 5 minutes
  strategies: ['meme-momentum', 'new-launch'],
  maxOpenPositions: 3,
  maxPositionSizeUsd: 50,
  takeProfitPercent: 0.3,
  stopLossPercent: 0.2,
  maxHoldTimeMinutes: 5,
  tradeCooldownMinutes: 1,
  maxDailyLossUsd: 100,
};

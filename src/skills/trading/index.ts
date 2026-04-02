/**
 * Trading Skill — Execute trading operations
 *
 * Actions:
 * - market_buy: Buy token at market price
 * - market_sell: Sell token at market price
 * - limit_buy: Place limit buy order
 * - limit_sell: Place limit sell order
 * - get_position: Check open position
 * - close_position: Close open position
 */

// NOTE: These providers will be implemented as part of #41, #42
// For now, we define minimal interfaces here to avoid circular dependencies
type TradingMode = 'task' | 'yolo';

interface WalletProvider {
  sendTransaction(tx: any): Promise<{ hash: string }>;
}

interface MarketDataProvider {
  getPrice(token: string): Promise<{ priceUsd: number; symbol: string }>;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type TradingAction = MarketBuyAction | MarketSellAction | GetPositionAction | ClosePositionAction;

export interface MarketBuyAction {
  type: 'market_buy';
  token: string;
  amountUsd: number;
  maxSlippage?: number; // 0.02 = 2%
}

export interface MarketSellAction {
  type: 'market_sell';
  token: string;
  percent?: number; // Sell X% of holding (default 100%)
  maxSlippage?: number;
}

export interface GetPositionAction {
  type: 'get_position';
  token?: string; // Specific token or all positions
}

export interface ClosePositionAction {
  type: 'close_position';
  token: string;
  reason?: 'take_profit' | 'stop_loss' | 'time_limit' | 'rug_pull' | 'manual';
}

export interface TradeResult {
  success: boolean;
  action: string;
  token: string;
  amount?: number;
  price?: number;
  totalUsd?: number;
  txHash?: string;
  error?: string;
}

export interface Position {
  token: string;
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  size: number;
  sizeUsd: number;
  pnlPercent: number;
  pnlUsd: number;
  openedAt: number;
  holdTimeMinutes: number;
}

// ── Trading Skill ────────────────────────────────────────────────────────────

export interface TradingSkillConfig {
  wallet: WalletProvider;
  marketData: MarketDataProvider;
  mode: TradingMode;
  maxSlippage: number;
}

export class TradingSkill {
  private wallet: WalletProvider;
  private marketData: MarketDataProvider;
  private mode: TradingMode;
  private maxSlippage: number;
  private positions: Map<string, Position> = new Map();

  constructor(config: TradingSkillConfig) {
    this.wallet = config.wallet;
    this.marketData = config.marketData;
    this.mode = config.mode;
    this.maxSlippage = config.maxSlippage;
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  async execute(action: TradingAction): Promise<TradeResult> {
    switch (action.type) {
      case 'market_buy':
        return this.marketBuy(action);
      case 'market_sell':
        return this.marketSell(action);
      case 'get_position':
        return this.getPosition(action);
      case 'close_position':
        return this.closePosition(action);
      default:
        return { success: false, action: 'unknown', token: '', error: 'Unknown action' };
    }
  }

  private async marketBuy(action: MarketBuyAction): Promise<TradeResult> {
    try {
      // Get current price
      const price = await this.marketData.getPrice(action.token);

      // Calculate amount (handle decimals)
      const amount = action.amountUsd / price.priceUsd;

      // Execute swap (simplified - would integrate with DEX)
      const tx = await this.wallet.sendTransaction({
        to: action.token,
        value: amount.toString(),
      });

      // Track position
      this.positions.set(action.token, {
        token: action.token,
        symbol: price.symbol,
        entryPrice: price.priceUsd,
        currentPrice: price.priceUsd,
        size: amount,
        sizeUsd: action.amountUsd,
        pnlPercent: 0,
        pnlUsd: 0,
        openedAt: Date.now(),
        holdTimeMinutes: 0,
      });

      return {
        success: true,
        action: 'market_buy',
        token: action.token,
        amount,
        price: price.priceUsd,
        totalUsd: action.amountUsd,
        txHash: tx.hash,
      };
    } catch (error) {
      return {
        success: false,
        action: 'market_buy',
        token: action.token,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async marketSell(action: MarketSellAction): Promise<TradeResult> {
    try {
      const position = this.positions.get(action.token);
      if (!position) {
        return {
          success: false,
          action: 'market_sell',
          token: action.token,
          error: 'No position found',
        };
      }

      // Get current price
      const price = await this.marketData.getPrice(action.token);

      // Calculate sell amount
      const sellPercent = action.percent ?? 100;
      const sellAmount = position.size * (sellPercent / 100);
      const sellValue = sellAmount * price.priceUsd;

      // Execute swap
      const tx = await this.wallet.sendTransaction({
        to: action.token,
        value: sellAmount.toString(),
      });

      // Calculate P&L
      const pnlUsd = sellValue - position.entryPrice * sellAmount;
      const pnlPercent = (pnlUsd / (position.entryPrice * sellAmount)) * 100;

      // Update or remove position
      if (sellPercent >= 100) {
        this.positions.delete(action.token);
      } else {
        position.size -= sellAmount;
        position.sizeUsd -= sellValue;
      }

      return {
        success: true,
        action: 'market_sell',
        token: action.token,
        amount: sellAmount,
        price: price.priceUsd,
        totalUsd: sellValue,
        txHash: tx.hash,
      };
    } catch (error) {
      return {
        success: false,
        action: 'market_sell',
        token: action.token,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async getPosition(action: GetPositionAction): Promise<TradeResult> {
    try {
      if (action.token) {
        const position = this.positions.get(action.token);
        if (!position) {
          return {
            success: true,
            action: 'get_position',
            token: action.token,
            error: 'No position found',
          };
        }

        // Update current price
        const price = await this.marketData.getPrice(action.token);
        position.currentPrice = price.priceUsd;
        position.pnlUsd = (price.priceUsd - position.entryPrice) * position.size;
        position.pnlPercent = ((price.priceUsd - position.entryPrice) / position.entryPrice) * 100;
        position.holdTimeMinutes = Math.floor((Date.now() - position.openedAt) / 60000);

        return {
          success: true,
          action: 'get_position',
          token: action.token,
        };
      }

      // Return all positions
      const allPositions = Array.from(this.positions.values());
      return {
        success: true,
        action: 'get_position',
        token: 'all',
      };
    } catch (error) {
      return {
        success: false,
        action: 'get_position',
        token: action.token || 'all',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async closePosition(action: ClosePositionAction): Promise<TradeResult> {
    // Close 100% of position
    return this.marketSell({
      type: 'market_sell',
      token: action.token,
      percent: 100,
    });
  }

  // ── Monitoring ──────────────────────────────────────────────────────────────

  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getPositionData(token: string): Position | undefined {
    return this.positions.get(token);
  }

  async updatePositions(): Promise<void> {
    for (const [token, position] of this.positions) {
      try {
        const price = await this.marketData.getPrice(token);
        position.currentPrice = price.priceUsd;
        position.pnlUsd = (price.priceUsd - position.entryPrice) * position.size;
        position.pnlPercent = ((price.priceUsd - position.entryPrice) / position.entryPrice) * 100;
        position.holdTimeMinutes = Math.floor((Date.now() - position.openedAt) / 60000);
      } catch (e) {
        // Keep old price if update fails
      }
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createTradingSkill(config: TradingSkillConfig): TradingSkill {
  return new TradingSkill(config);
}

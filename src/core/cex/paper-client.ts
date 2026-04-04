/**
 * Paper CEX client — simulates trading without real money.
 * Uses the paper-portfolio system for balances and trade recording.
 */
import { Effect } from 'effect';
import { DatabaseLive } from '../../services/database';
import { PaperPortfolioService, PaperPortfolioServiceLive } from '../../services/paper-portfolio';
import type { CexBalance, CexClient, CexOrder, CexOrderResult, CexPosition, CexTicker } from './types';

// Helper to run PaperPortfolioService effects
async function runPaperPortfolioEffect<T>(effect: Effect.Effect<T, unknown, PaperPortfolioService>): Promise<T> {
  const program = effect.pipe(Effect.provide(PaperPortfolioServiceLive), Effect.provide(DatabaseLive));
  return Effect.runPromise(program as Effect.Effect<T>);
}

export class PaperCexClient implements CexClient {
  readonly exchange = 'binance' as const;
  private userId: number;

  constructor(userId = 0) {
    this.userId = userId;
  }

  async getBalances(): Promise<CexBalance[]> {
    const balances = await runPaperPortfolioEffect(
      Effect.flatMap(PaperPortfolioService, (service) => service.getBalances(this.userId))
    );
    return balances.map((b) => ({
      asset: b.asset,
      free: b.amount,
      locked: 0,
    }));
  }

  async getPositions(): Promise<CexPosition[]> {
    return [];
  }

  async placeOrder(order: CexOrder): Promise<CexOrderResult> {
    const balances = await runPaperPortfolioEffect(
      Effect.flatMap(PaperPortfolioService, (service) => service.getBalances(this.userId))
    );
    const balance = balances.find((b) => b.asset === 'USDT') ?? balances.find((b) => b.asset === 'USDC');

    if (!balance || balance.amount <= 0) {
      throw new Error('Insufficient paper balance');
    }

    const cost = order.price ? order.amount * order.price : order.amount * 100; // fallback price
    if (order.side === 'buy' && balance.amount < cost) {
      throw new Error(`Insufficient paper balance: need ${cost}, have ${balance.amount}`);
    }

    // Update paper balances
    if (order.side === 'buy') {
      await runPaperPortfolioEffect(
        Effect.flatMap(PaperPortfolioService, (service) => service.adjustBalance(this.userId, 'USDT', -cost))
      );
      await runPaperPortfolioEffect(
        Effect.flatMap(PaperPortfolioService, (service) =>
          service.adjustBalance(this.userId, order.symbol.replace('USDT', ''), order.amount)
        )
      );
    } else {
      await runPaperPortfolioEffect(
        Effect.flatMap(PaperPortfolioService, (service) =>
          service.adjustBalance(this.userId, order.symbol.replace('USDT', ''), -order.amount)
        )
      );
      await runPaperPortfolioEffect(
        Effect.flatMap(PaperPortfolioService, (service) => service.adjustBalance(this.userId, 'USDT', cost))
      );
    }

    // Record the trade
    const orderId = await runPaperPortfolioEffect(
      Effect.flatMap(PaperPortfolioService, (service) =>
        service.recordTrade(this.userId, {
          venue: 'paper',
          actionType: 'cex_place_order',
          symbol: order.symbol,
          side: order.side,
          price: order.price,
          size: order.amount,
          amountUsd: cost,
        })
      )
    );

    return { orderId, status: 'FILLED' };
  }

  async cancelOrder(_symbol: string, _orderId: string): Promise<void> {
    // No-op for paper mode
  }

  async getTicker(symbol: string): Promise<CexTicker> {
    // Return a mock price — in paper mode, exact price doesn't matter
    return { symbol, price: '100.00' };
  }

  async withdraw(asset: string, amount: number, address: string, _network: string): Promise<string> {
    await runPaperPortfolioEffect(
      Effect.flatMap(PaperPortfolioService, (service) => service.adjustBalance(this.userId, asset, -amount))
    );
    await runPaperPortfolioEffect(
      Effect.flatMap(PaperPortfolioService, (service) =>
        service.recordTrade(this.userId, {
          venue: 'paper',
          actionType: 'cex_withdraw',
          symbol: asset,
          side: 'sell',
          size: amount,
          amountUsd: amount,
        })
      )
    );
    return `paper-withdraw-${address.slice(0, 6)}-${Date.now()}`;
  }
}

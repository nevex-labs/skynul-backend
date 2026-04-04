/**
 * CEX (Centralized Exchange) types and interface.
 *
 * All CEX clients (Binance, Coinbase, etc.) implement CexClient.
 * Paper mode is handled by PaperCexClient.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type CexExchangeId = 'binance' | 'coinbase' | 'okx' | 'bybit' | 'kucoin' | 'gate' | 'htx' | 'mexc' | 'cryptocom';

export interface CexBalance {
  asset: string;
  free: number;
  locked: number;
}

export interface CexPosition {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
}

export interface CexOrder {
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  amount: number;
  price?: number;
}

export interface CexOrderResult {
  orderId: string;
  status: string;
}

export interface CexTicker {
  symbol: string;
  price: string;
}

// ── Interface ──────────────────────────────────────────────────────────────────

export interface CexClient {
  readonly exchange: CexExchangeId;

  getBalances(): Promise<CexBalance[]>;
  getPositions(): Promise<CexPosition[]>;
  placeOrder(order: CexOrder): Promise<CexOrderResult>;
  cancelOrder(symbol: string, orderId: string): Promise<void>;
  getTicker(symbol: string): Promise<CexTicker>;
  withdraw(asset: string, amount: number, address: string, network: string): Promise<string>;
}

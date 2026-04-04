import { BinanceClient } from './binance-client';
import { CoinbaseClient } from './coinbase-client';
import { PaperCexClient } from './paper-client';
/**
 * Factory for creating CEX clients.
 * Returns the appropriate client based on exchange ID and paper mode.
 */
import { CexClient } from './types';

export type CexExchangeId = 'binance' | 'coinbase';

/**
 * Get a CEX client instance.
 * @param exchange - The exchange ID ('binance' or 'coinbase')
 * @param paperMode - Whether to use paper trading mode
 * @returns A CexClient implementation
 */
export function getCexClient(exchange: CexExchangeId, paperMode: boolean): CexClient {
  if (paperMode) {
    return new PaperCexClient();
  }

  switch (exchange) {
    case 'binance':
      return new BinanceClient();
    case 'coinbase':
      return new CoinbaseClient();
    default:
      throw new Error(`Unsupported exchange: ${exchange}`);
  }
}

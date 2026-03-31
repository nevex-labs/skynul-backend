import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { getAllChains } from '../../core/chain/config';
import { TradingSettingsSchema } from '../../core/stores/schemas';
import { loadTradingSettings, saveTradingSettings } from '../../core/stores/trading-store';
import { type CexExchangeId, type TradingSettings } from '../../types/trading';

let trading = await loadTradingSettings();

const CEX_EXCHANGES: Array<{ id: CexExchangeId; label: string; liveImplemented: boolean }> = [
  { id: 'binance', label: 'Binance', liveImplemented: true },
  { id: 'coinbase', label: 'Coinbase', liveImplemented: true },
  { id: 'okx', label: 'OKX', liveImplemented: false },
  { id: 'bybit', label: 'Bybit', liveImplemented: false },
  { id: 'kucoin', label: 'KuCoin', liveImplemented: false },
  { id: 'gate', label: 'Gate.io', liveImplemented: false },
  { id: 'htx', label: 'HTX', liveImplemented: false },
  { id: 'mexc', label: 'MEXC', liveImplemented: false },
  { id: 'cryptocom', label: 'Crypto.com', liveImplemented: false },
];

const tradingRoutes = new Hono()
  .get('/settings', async (c) => {
    return c.json(trading);
  })
  .put('/settings', zValidator('json', TradingSettingsSchema), async (c) => {
    trading = c.req.valid('json') as TradingSettings;
    await saveTradingSettings(trading);
    return c.json(trading);
  })
  .get('/providers', async (c) => {
    const chains = getAllChains();
    return c.json({
      cex: {
        exchanges: CEX_EXCHANGES,
      },
      dex: {
        evm: {
          supportedChainIds: chains.map((x) => x.chainId),
        },
        solana: { supported: false },
        bitcoin: { supported: false },
      },
    });
  });

export { tradingRoutes as trading };
export type TradingRoute = typeof tradingRoutes;

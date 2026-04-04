/**
 * Adapter para reemplazar trading-store con SettingsService (Effect + PostgreSQL)
 */
import { Effect } from 'effect';
import { AppLayer } from '../../config/layers';
import { SettingsService } from '../../services/settings';
import type { CexExchangeId, TradingSettings } from '../../types/trading';

const SYSTEM_USER_ID = 1;

// Default trading settings compatible con el tipo legacy TradingSettings
const DEFAULT_TRADING: TradingSettings = {
  version: 1,
  cex: {
    defaultExchange: 'binance',
    exchanges: {
      binance: { enabled: true, scopes: { spot: true, futures: false, withdraw: false } },
      coinbase: { enabled: true, scopes: { spot: true, futures: false, withdraw: false } },
      okx: { enabled: false, scopes: { spot: false, futures: false, withdraw: false } },
      bybit: { enabled: false, scopes: { spot: false, futures: false, withdraw: false } },
      kucoin: { enabled: false, scopes: { spot: false, futures: false, withdraw: false } },
      gate: { enabled: false, scopes: { spot: false, futures: false, withdraw: false } },
      htx: { enabled: false, scopes: { spot: false, futures: false, withdraw: false } },
      mexc: { enabled: false, scopes: { spot: false, futures: false, withdraw: false } },
      cryptocom: { enabled: false, scopes: { spot: false, futures: false, withdraw: false } },
    },
  },
  dex: {
    evm: { enabledChainIds: [], defaultChainId: 0 },
    solana: { enabled: false },
    bitcoin: { enabled: false },
  },
};

export async function loadTradingSettings(): Promise<TradingSettings> {
  const program = Effect.gen(function* () {
    const service = yield* SettingsService;
    return yield* service.getTradingSettings(SYSTEM_USER_ID);
  });

  const result = await Effect.runPromiseExit(program.pipe(Effect.provide(AppLayer)));

  if (result._tag === 'Success') {
    const db = result.value;
    // Convert DB structure to legacy TradingSettings
    const cexProviders = (db.cexProviders as string[]) || [];
    const dexProviders = (db.dexProviders as string[]) || [];
    const chainConfigs = (db.chainConfigs as Record<string, any>) || {};

    const exchanges: Record<
      string,
      { enabled: boolean; scopes: { spot: boolean; futures: boolean; withdraw: boolean } }
    > = {};
    const exchangeList = ['binance', 'coinbase', 'okx', 'bybit', 'kucoin', 'gate', 'htx', 'mexc', 'cryptocom'];
    for (const ex of exchangeList) {
      exchanges[ex] = {
        enabled: cexProviders.includes(ex),
        scopes: { spot: true, futures: false, withdraw: false },
      };
    }

    const enabledChains = dexProviders
      .map((p: string) => {
        const match = p.match(/(\d+)/);
        return match ? Number.parseInt(match[1], 10) : 0;
      })
      .filter((n: number) => n > 0);

    return {
      version: 1,
      cex: {
        defaultExchange: (cexProviders[0] as CexExchangeId) || 'binance',
        exchanges,
      },
      dex: {
        evm: {
          enabledChainIds: enabledChains.length > 0 ? enabledChains : DEFAULT_TRADING.dex.evm.enabledChainIds,
          defaultChainId: enabledChains[0] || DEFAULT_TRADING.dex.evm.defaultChainId,
        },
        solana: { enabled: dexProviders.some((p: string) => p.toLowerCase().includes('solana')) },
        bitcoin: { enabled: dexProviders.some((p: string) => p.toLowerCase().includes('bitcoin')) },
      },
    };
  }

  console.error('[trading-adapter] loadTradingSettings error:', result.cause);
  return DEFAULT_TRADING;
}

export async function saveTradingSettings(_settings: TradingSettings) {
  console.warn('[trading-adapter] saveTradingSettings is deprecated, use SettingsService.updateTradingSettings');
}

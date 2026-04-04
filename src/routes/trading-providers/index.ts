/**
 * Unified Trading Providers API.
 *
 * Single source of truth for all trading provider management:
 * - CEX (Binance, Coinbase, OKX, etc.)
 * - Prediction Markets (Polymarket)
 * - DEX/On-Chain (via wallet)
 *
 * All secrets are stored via ProviderSecretsService (encrypted).
 */

import { Effect } from 'effect';
import { Hono } from 'hono';
import { AppLayer } from '../../config/layers';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { ProviderSecretsService } from '../../services/provider-secrets';
import { SettingsService } from '../../services/settings';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Trading provider operation error:', error);
  return Http.internalError();
};

function getUserId(c: any): number | null {
  return (c.get('jwtPayload') as any)?.userId ?? null;
}

interface TradingProviderField {
  key: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
}

interface TradingProviderDef {
  id: string;
  name: string;
  description: string;
  category: 'cex' | 'prediction' | 'dex';
  fields: TradingProviderField[];
  paperSupported: boolean;
}

const TRADING_PROVIDERS: TradingProviderDef[] = [
  {
    id: 'binance',
    name: 'Binance',
    description: "World's largest crypto exchange",
    category: 'cex',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text', placeholder: 'Your Binance API key' },
      { key: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'Your Binance API secret' },
    ],
    paperSupported: true,
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    description: 'US-based regulated exchange',
    category: 'cex',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text', placeholder: 'Your Coinbase API key name' },
      { key: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'Your Coinbase API secret (PEM)' },
    ],
    paperSupported: true,
  },
  {
    id: 'polymarket',
    name: 'Polymarket',
    description: 'Prediction market on Polygon',
    category: 'prediction',
    fields: [
      { key: 'privateKey', label: 'Private Key', type: 'password', placeholder: 'Your Ethereum private key (0x...)' },
      { key: 'funderAddress', label: 'Funder Address', type: 'text', placeholder: 'Address that funds positions' },
    ],
    paperSupported: true,
  },
  {
    id: 'okx',
    name: 'OKX',
    description: 'Global crypto exchange',
    category: 'cex',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text', placeholder: 'Your OKX API key' },
      { key: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'Your OKX API secret' },
      { key: 'passphrase', label: 'Passphrase', type: 'password', placeholder: 'Your OKX passphrase' },
    ],
    paperSupported: true,
  },
  {
    id: 'bybit',
    name: 'Bybit',
    description: 'Derivatives-focused exchange',
    category: 'cex',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text', placeholder: 'Your Bybit API key' },
      { key: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'Your Bybit API secret' },
    ],
    paperSupported: true,
  },
  {
    id: 'kucoin',
    name: 'KuCoin',
    description: 'Global crypto exchange',
    category: 'cex',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text', placeholder: 'Your KuCoin API key' },
      { key: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'Your KuCoin API secret' },
      { key: 'passphrase', label: 'Passphrase', type: 'password', placeholder: 'Your KuCoin passphrase' },
    ],
    paperSupported: true,
  },
  {
    id: 'gate',
    name: 'Gate.io',
    description: 'Crypto exchange with altcoins',
    category: 'cex',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text', placeholder: 'Your Gate.io API key' },
      { key: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'Your Gate.io API secret' },
    ],
    paperSupported: true,
  },
  {
    id: 'htx',
    name: 'HTX (Huobi)',
    description: 'Formerly Huobi Global',
    category: 'cex',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text', placeholder: 'Your HTX API key' },
      { key: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'Your HTX API secret' },
    ],
    paperSupported: true,
  },
  {
    id: 'mexc',
    name: 'MEXC',
    description: 'Low-fee crypto exchange',
    category: 'cex',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text', placeholder: 'Your MEXC API key' },
      { key: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'Your MEXC API secret' },
    ],
    paperSupported: true,
  },
  {
    id: 'cryptocom',
    name: 'Crypto.com',
    description: 'Crypto.com Exchange',
    category: 'cex',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text', placeholder: 'Your Crypto.com API key' },
      { key: 'apiSecret', label: 'API Secret', type: 'password', placeholder: 'Your Crypto.com API secret' },
    ],
    paperSupported: true,
  },
];

const tradingProvidersGroup = new Hono()
  // GET /api/trading-providers — list all with connection status
  .get(
    '/',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const secrets = yield* ProviderSecretsService;

        const providers = yield* Effect.forEach(TRADING_PROVIDERS, (def) =>
          Effect.gen(function* () {
            const fields: Record<string, boolean> = {};
            for (const field of def.fields) {
              const exists = yield* secrets
                .hasSecret(def.id, field.key)
                .pipe(Effect.catchAll(() => Effect.succeed(false)));
              fields[field.key] = exists;
            }
            const connected = Object.values(fields).every(Boolean);

            return {
              id: def.id,
              name: def.name,
              description: def.description,
              category: def.category,
              fields: def.fields,
              connected,
              paperSupported: def.paperSupported,
            };
          })
        );

        return Http.ok({ providers });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )

  // PUT /api/trading-providers/:id/connect — connect a provider
  .put(
    '/:id/connect',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const id = c.req.param('id') as string;
        const def = TRADING_PROVIDERS.find((p) => p.id === id);
        if (!def) return Http.notFound(`Provider "${id}"`);

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        if (!body || typeof body !== 'object') {
          return Http.badRequest('Request body is required');
        }

        const secrets = yield* ProviderSecretsService;

        // Validate and store each field
        for (const field of def.fields) {
          const value = (body as Record<string, unknown>)[field.key];
          if (!value || typeof value !== 'string') {
            return Http.badRequest(`${field.label} is required`);
          }
          yield* secrets.setSecret(def.id, field.key, value);
        }

        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )

  // DELETE /api/trading-providers/:id — disconnect a provider
  .delete(
    '/:id',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const id = c.req.param('id') as string;
        const def = TRADING_PROVIDERS.find((p) => p.id === id);
        if (!def) return Http.notFound(`Provider "${id}"`);

        const secrets = yield* ProviderSecretsService;

        // Delete all fields (ignore errors if some don't exist)
        for (const field of def.fields) {
          yield* secrets.deleteSecret(def.id, field.key).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
        }

        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  );

export { tradingProvidersGroup };
export type TradingProvidersGroup = typeof tradingProvidersGroup;

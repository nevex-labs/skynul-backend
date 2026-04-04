import { Effect } from 'effect';
import { Hono } from 'hono';
import { AppLayer } from '../../config/layers';
import { getAllChains } from '../../core/chain/config';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { SettingsService } from '../../services/settings';
import type { CexExchangeId } from '../../shared/types/trading';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Trading operation error:', error);
  return Http.internalError();
};

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
  .get(
    '/settings',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) {
          return Http.unauthorized();
        }

        const service = yield* SettingsService;
        const settings = yield* service.getTradingSettings(userId);
        return Http.ok(settings);
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/settings',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) {
          return Http.unauthorized();
        }

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        if (!body || typeof body !== 'object') {
          return Http.badRequest('Invalid request body');
        }

        const service = yield* SettingsService;
        const settings = yield* service.updateTradingSettings(userId, {
          paperTrading: body.paperTrading,
          autoApprove: body.autoApprove,
          cexProviders: body.cexProviders,
          dexProviders: body.dexProviders,
          chainConfigs: body.chainConfigs,
        });

        return Http.ok(settings);
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .get(
    '/providers',
    handler((c) =>
      Effect.gen(function* () {
        const chains = getAllChains();
        return Http.ok({
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
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  );

export { tradingRoutes as trading };
export type TradingRoute = typeof tradingRoutes;

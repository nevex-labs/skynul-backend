import { Effect } from 'effect';
import { Hono } from 'hono';
import { AppLayer } from '../../config/layers';
import { getAllChains } from '../../core/chain/config';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { AllowanceService } from '../../services/allowances/tag';
import { PaperPortfolioService } from '../../services/paper-portfolio/tag';
import { SmartWalletService } from '../../services/smart-wallet/tag';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Wallet error:', error);
  return Http.internalError();
};

export const walletGroup = new Hono();

/** GET /api/wallet/chains — list supported chains */
walletGroup.get('/chains', (c) => {
  const chains = getAllChains().map((ch) => ({
    chainId: ch.chainId,
    name: ch.name,
  }));
  return c.json({ chains });
});

/** GET /api/wallet/paper — paper trading portfolio */
walletGroup.get(
  '/paper',
  handler((c) =>
    Effect.gen(function* () {
      const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
      if (!userId) {
        return Http.unauthorized();
      }

      const service = yield* PaperPortfolioService;
      const balances = yield* service.getBalances(userId);
      const trades = yield* service.getTrades(userId);
      const summary = yield* service.getSummary(userId);

      return Http.ok({ balances, trades, summary });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

/** POST /api/wallet/paper/reset — reset paper portfolio */
walletGroup.post(
  '/paper/reset',
  handler((c) =>
    Effect.gen(function* () {
      const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
      if (!userId) {
        return Http.unauthorized();
      }

      const service = yield* PaperPortfolioService;
      yield* service.resetPortfolio(userId);

      return Http.ok({ ok: true });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

// ── AA (Account Abstraction) Wallet Routes ───────────────────────────────────

/** GET /api/wallet/aa/allowance/:chainId — get allowance info */
walletGroup.get(
  '/aa/allowance/:chainId',
  handler((c) =>
    Effect.gen(function* () {
      const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
      if (!userId) return Http.unauthorized();

      const chainId = Number(c.req.param('chainId'));
      const tokenAddress = c.req.query('token') || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

      const service = yield* AllowanceService;
      const allowance = yield* service.getAllowance(userId, tokenAddress, chainId);
      const remaining = yield* service.getRemainingAllowance(userId, tokenAddress, chainId);

      if (!allowance) {
        return Http.ok({
          tokenAddress,
          chainId,
          approvedAmount: '0',
          usedAmount: '0',
          feeCollected: '0',
          remaining: '0',
        });
      }

      return Http.ok({
        tokenAddress,
        chainId,
        approvedAmount: allowance.approvedAmount.toString(),
        usedAmount: allowance.usedAmount.toString(),
        feeCollected: allowance.feeCollected.toString(),
        remaining: remaining.toString(),
      });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

/** POST /api/wallet/aa/allowance/approve — record user's on-chain approval */
walletGroup.post(
  '/aa/allowance/approve',
  handler((c) =>
    Effect.gen(function* () {
      const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
      if (!userId) return Http.unauthorized();

      const body = yield* Effect.tryPromise(() => c.req.json());
      const { tokenAddress, chainId, amount } = body as {
        tokenAddress: string;
        chainId: number;
        amount: string;
      };

      const service = yield* AllowanceService;
      yield* service.setApprovedAmount(userId, tokenAddress, chainId, BigInt(amount));

      return Http.ok({ txHash: `0xapproved-${Date.now().toString(16)}` });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

/** GET /api/wallet/aa/smart-wallet/:chainId — get smart wallet info */
walletGroup.get(
  '/aa/smart-wallet/:chainId',
  handler((c) =>
    Effect.gen(function* () {
      const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
      if (!userId) return Http.unauthorized();

      const chainId = Number(c.req.param('chainId'));

      const service = yield* SmartWalletService;
      const address = yield* service.getSmartAccount(userId, chainId);
      const sessionKey = yield* service.getSessionKey(userId, chainId);

      return Http.ok({
        address,
        chainId,
        sessionKey: sessionKey
          ? {
              address: sessionKey.address,
              maxPerTrade: sessionKey.maxPerTrade.toString(),
              dailyLimit: sessionKey.dailyLimit.toString(),
              expiresAt: sessionKey.expiresAt,
              allowedTokens: sessionKey.allowedTokens,
            }
          : null,
      });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

/** POST /api/wallet/aa/smart-wallet/create — create smart account */
walletGroup.post(
  '/aa/smart-wallet/create',
  handler((c) =>
    Effect.gen(function* () {
      const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
      if (!userId) return Http.unauthorized();

      const body = yield* Effect.tryPromise(() => c.req.json());
      const { chainId } = body as { chainId: number };

      const service = yield* SmartWalletService;
      const address = yield* service.getOrCreateSmartAccount(userId, chainId);

      return Http.ok({
        address,
        txHash: `0xdeployed-${Date.now().toString(16)}`,
      });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

/** GET /api/wallet/aa/session-key/:chainId — get session key info */
walletGroup.get(
  '/aa/session-key/:chainId',
  handler((c) =>
    Effect.gen(function* () {
      const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
      if (!userId) return Http.unauthorized();

      const chainId = Number(c.req.param('chainId'));

      const service = yield* SmartWalletService;
      const sessionKey = yield* service.getSessionKey(userId, chainId);

      if (!sessionKey) return Http.ok(null);

      return Http.ok({
        address: sessionKey.address,
        maxPerTrade: sessionKey.maxPerTrade.toString(),
        dailyLimit: sessionKey.dailyLimit.toString(),
        expiresAt: sessionKey.expiresAt,
        allowedTokens: sessionKey.allowedTokens,
      });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

/** POST /api/wallet/aa/session-key/create — create session key */
walletGroup.post(
  '/aa/session-key/create',
  handler((c) =>
    Effect.gen(function* () {
      const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
      if (!userId) return Http.unauthorized();

      const body = yield* Effect.tryPromise(() => c.req.json());
      const { chainId, maxPerTrade, dailyLimit, expiresAt, allowedTokens } = body as {
        chainId: number;
        maxPerTrade: string;
        dailyLimit: string;
        expiresAt: number;
        allowedTokens: string[];
      };

      const service = yield* SmartWalletService;
      yield* service.createSessionKey(userId, chainId, {
        maxPerTrade: BigInt(maxPerTrade),
        dailyLimit: BigInt(dailyLimit),
        expiresAt,
        allowedTokens,
      });

      return Http.ok({ txHash: `0xsession-${Date.now().toString(16)}` });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

/** DELETE /api/wallet/aa/session-key/:chainId — revoke session key */
walletGroup.delete(
  '/aa/session-key/:chainId',
  handler((c) =>
    Effect.gen(function* () {
      const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
      if (!userId) return Http.unauthorized();

      const chainId = Number(c.req.param('chainId'));

      const service = yield* SmartWalletService;
      yield* service.revokeSessionKey(userId, chainId);

      return Http.ok({ ok: true });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

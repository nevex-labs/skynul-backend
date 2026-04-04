import { randomBytes } from 'crypto';
import { Effect } from 'effect';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { AppLayer } from '../../config/layers';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { WalletService } from '../../services/wallets';
import type { ChainType } from '../../services/wallets';

// address -> { nonce, expiresAt }
const pendingNonces = new Map<string, { nonce: string; expiresAt: number }>();

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Wallet auth error:', error);
  if (error instanceof Error) {
    return Http.badRequest(error.message);
  }
  return Http.internalError();
};

const JWT_SECRET = process.env.JWT_SECRET || process.env.MASTER_KEY || 'skynul-dev-secret';
const JWT_EXPIRES_IN = 7 * 24 * 60 * 60; // 7 days

export const walletAuthGroup = new Hono();

// GET /auth/wallet/nonce?address=0x...&chain=evm
walletAuthGroup.get('/nonce', (c) => {
  const address = c.req.query('address')?.toLowerCase();
  const chain = (c.req.query('chain') || 'evm') as ChainType;

  if (!address) return c.json({ error: 'Missing address' }, 400);

  const nonce = randomBytes(16).toString('hex');
  pendingNonces.set(address, { nonce, expiresAt: Date.now() + 1000 * 60 * 5 }); // 5 min

  return c.json({
    nonce,
    message: `Sign in to Skynul\n\nNonce: ${nonce}\n\nThis request will not trigger a blockchain transaction or cost any gas fees.`,
    chain,
  });
});

// POST /auth/wallet/verify { address, signature, chain? }
walletAuthGroup.post('/verify', async (c) => {
  const body = await c.req.json<{ address: string; signature: string; chain?: ChainType }>();
  const chain = (body.chain || 'evm') as ChainType;

  return handler((ctx) =>
    Effect.gen(function* () {
      if (!body.address || !body.signature) {
        return Http.badRequest('Missing address or signature');
      }

      const key = body.address.toLowerCase();
      const pending = pendingNonces.get(key);
      if (!pending || Date.now() > pending.expiresAt) {
        return Http.badRequest('Nonce expired or not found');
      }
      pendingNonces.delete(key);

      const message = `Sign in to Skynul\n\nNonce: ${pending.nonce}\n\nThis request will not trigger a blockchain transaction or cost any gas fees.`;

      // Verify signature — try EOA first, then ERC-6492 for smart wallets
      const { recoverMessageAddress, getAddress, createPublicClient, http } = yield* Effect.promise(
        () => import('viem')
      );
      const { base } = yield* Effect.promise(() => import('viem/chains'));

      let recoveredAddress: string;
      const signature = body.signature as `0x${string}`;

      // Step 1: Try standard EOA recovery (MetaMask, etc.)
      // Wrapped in async function to catch sync errors from viem
      const tryEoaRecovery = async () => {
        try {
          return await recoverMessageAddress({ message, signature });
        } catch {
          return null;
        }
      };

      const eoaResult = yield* Effect.promise(tryEoaRecovery);

      if (eoaResult) {
        recoveredAddress = eoaResult;
      } else {
        // Step 2: Try ERC-6492 smart wallet verification (Coinbase Smart Wallet, etc.)
        const rpcUrl = process.env.ETH_RPC_URL ?? 'https://mainnet.base.org';
        const client = createPublicClient({ chain: base, transport: http(rpcUrl) });

        const trySmartWalletVerify = async () => {
          try {
            return await client.verifyMessage({
              address: key as `0x${string}`,
              message,
              signature,
            });
          } catch {
            return false;
          }
        };

        const isValid = yield* Effect.promise(trySmartWalletVerify);

        if (!isValid) {
          return Http.unauthorized();
        }

        // For smart wallets, we trust the claimed address if the signature is valid
        recoveredAddress = getAddress(key as `0x${string}`);
      }

      // Verify recovered address matches the claimed address
      if (recoveredAddress.toLowerCase() !== key) {
        return Http.unauthorized();
      }

      // Normalize to checksum address
      recoveredAddress = getAddress(recoveredAddress);

      // Find or create user + wallet
      const walletService = yield* WalletService;
      const { userId, wallet } = yield* walletService.findOrCreateUser(recoveredAddress, chain);

      // Issue JWT
      const token = yield* Effect.promise(() =>
        sign(
          {
            userId,
            walletAddress: recoveredAddress,
            chain,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + JWT_EXPIRES_IN,
          },
          JWT_SECRET
        )
      );

      return Http.ok({
        token,
        user: {
          id: userId,
          walletAddress: recoveredAddress,
          chain,
          isPrimary: wallet.isPrimary,
        },
      });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )(c);
});

// GET /auth/wallet/me — returns current user info (requires JWT)
walletAuthGroup.get(
  '/me',
  handler((c) =>
    Effect.gen(function* () {
      const payload = c.get('jwtPayload');
      if (!(payload as any)?.userId) {
        return Http.unauthorized();
      }

      const walletService = yield* WalletService;
      const wallets = yield* walletService.getUserWallets((payload as any).userId);

      return Http.ok({
        userId: (payload as any).userId,
        wallets: wallets.map((w) => ({
          address: w.address,
          chain: w.chain,
          isPrimary: w.isPrimary,
          lastSignedAt: w.lastSignedAt,
        })),
      });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

// POST /auth/wallet/disconnect { chain } — remove a wallet (requires JWT)
walletAuthGroup.post(
  '/disconnect',
  handler((c) =>
    Effect.gen(function* () {
      const payload = c.get('jwtPayload');
      if (!(payload as any)?.userId) {
        return Http.unauthorized();
      }

      const body = yield* Effect.tryPromise({
        try: () => c.req.json(),
        catch: () => null,
      });

      const chain = (body?.chain || 'evm') as ChainType;
      const walletService = yield* WalletService;
      const wallets = yield* walletService.getUserWallets((payload as any).userId);

      // Don't allow disconnecting the last wallet
      if (wallets.length <= 1) {
        return Http.badRequest('Cannot disconnect your only wallet');
      }

      yield* walletService.removeWallet((payload as any).walletAddress, chain);

      return Http.ok({ ok: true });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

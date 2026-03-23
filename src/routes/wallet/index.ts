import { Hono } from 'hono';
import { getAllChains, getChainConfig, getDefaultChainId } from '../../core/chain/config';
import { EvmWallet } from '../../core/chain/evm-wallet';
import {
  getPaperPortfolioSummary,
  getPaperBalances,
  getPaperTrades,
  resetPaperPortfolio,
} from '../../core/agent/paper-portfolio';

export const walletGroup = new Hono();

/** GET /api/wallet/address — return current wallet address or 404 */
walletGroup.get('/address', async (c) => {
  const exists = await EvmWallet.exists();
  if (!exists) return c.json({ error: 'No wallet configured' }, 404);

  const wallet = await EvmWallet.load();
  if (!wallet) return c.json({ error: 'Failed to load wallet' }, 500);

  return c.json({ address: wallet.getAddress() });
});

/** GET /api/wallet/balance/:chainId — native + USDC balance */
walletGroup.get('/balance/:chainId', async (c) => {
  const chainIdRaw = c.req.param('chainId');
  const chainId = Number.parseInt(chainIdRaw, 10);
  if (!Number.isFinite(chainId)) {
    return c.json({ error: 'Invalid chainId' }, 400);
  }

  const chain = getChainConfig(chainId);
  if (!chain) return c.json({ error: `Unknown chainId: ${chainId}` }, 400);

  const wallet = await EvmWallet.load();
  if (!wallet) return c.json({ error: 'No wallet configured' }, 404);

  try {
    const [native, usdc] = await Promise.all([
      wallet.getNativeBalance(chainId),
      wallet.getUsdcBalance(chainId),
    ]);
    return c.json({ chainId, chainName: chain.name, native, usdc });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** POST /api/wallet/create — generate new EOA wallet */
walletGroup.post('/create', async (c) => {
  try {
    const result = await EvmWallet.create();
    return c.json({ address: result.address });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** GET /api/wallet/chains — list supported chains */
walletGroup.get('/chains', (c) => {
  const chains = getAllChains().map((ch) => ({
    chainId: ch.chainId,
    name: ch.name,
    testnet: ch.testnet,
    explorerUrl: ch.explorerUrl,
    nativeCurrency: ch.nativeCurrency,
    usdcAddress: ch.usdcAddress,
  }));
  return c.json({ chains, defaultChainId: getDefaultChainId() });
});

/** GET /api/wallet/paper — paper portfolio summary */
walletGroup.get('/paper', (c) => {
  try {
    const summary = getPaperPortfolioSummary();
    return c.json(summary);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** GET /api/wallet/paper/balances — paper balances */
walletGroup.get('/paper/balances', (c) => {
  try {
    const balances = getPaperBalances();
    return c.json({ balances });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** GET /api/wallet/paper/trades — paper trades */
walletGroup.get('/paper/trades', (c) => {
  try {
    const venue = c.req.query('venue');
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const trades = getPaperTrades({ venue, limit: Number.isFinite(limit) ? limit : undefined });
    return c.json({ trades });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** POST /api/wallet/paper/reset — reset paper portfolio */
walletGroup.post('/paper/reset', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const startingBalance = typeof body.startingBalance === 'number' ? body.startingBalance : undefined;
    resetPaperPortfolio(startingBalance);
    return c.json({ ok: true, startingBalance: startingBalance ?? 10_000 });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

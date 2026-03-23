import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (hoisted) ────────────────────────────────────────────────────

const M = vi.hoisted(() => ({
  chainInstance: null as any,
  binanceInstance: null as any,
  coinbaseInstance: null as any,
}));

vi.mock('../chain/chain-client', () => ({
  ChainClient: vi.fn(function (this: any, _chainId?: number) {
    return M.chainInstance;
  }),
}));

vi.mock('../cex/binance-client', () => ({
  BinanceClient: vi.fn(function (this: any, _opts?: unknown) {
    return M.binanceInstance;
  }),
}));

vi.mock('../cex/coinbase-client', () => ({
  CoinbaseClient: vi.fn(function (this: any, _opts?: unknown) {
    return M.coinbaseInstance;
  }),
}));

vi.mock('../chain/fee-service', () => ({
  FEE_USDC: '0.40',
  FeeService: {
    deductFeeFromAmount: vi.fn(),
    collectFee: vi.fn(),
    canCollectFee: vi.fn(),
    getTreasuryAddress: vi.fn(),
  },
}));

// Risk guard always allows in executor tests — risk logic has its own test file
vi.mock('./risk-guard', () => ({
  checkTradeAllowed: vi.fn(() => ({ allowed: true })),
  recordTradeVolume: vi.fn(),
  openRiskPosition: vi.fn(),
  closeRiskPosition: vi.fn(),
  closeAllPositionsForTask: vi.fn(),
}));

import { BinanceClient } from '../cex/binance-client';
import { CoinbaseClient } from '../cex/coinbase-client';
import { ChainClient } from '../chain/chain-client';
import { FeeService } from '../chain/fee-service';
import { executeCexAction, executeChainAction } from './action-executors';
import type { ExecutorContext } from './action-executors';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(): ExecutorContext {
  return {
    task: {
      id: 't1',
      prompt: '',
      status: 'running',
      mode: 'code',
      steps: [],
      capabilities: [],
      maxSteps: 10,
      timeoutMs: 60000,
      createdAt: 0,
      updatedAt: 0,
    } as any,
    taskManager: null,
    appBridge: { run: vi.fn() } as any,
    pushUpdate: vi.fn(),
    pushStatus: vi.fn(),
  };
}

function makeChainInstance(overrides?: Record<string, unknown>) {
  return {
    getBalance: vi
      .fn()
      .mockResolvedValue({ symbol: 'USDC', balance: '10.00', address: '0xusdc', balanceRaw: '0', decimals: 6 }),
    getNativeBalance: vi
      .fn()
      .mockResolvedValue({ symbol: 'ETH', balance: '0.5', address: '', balanceRaw: '0', decimals: 18 }),
    getTokenBalance: vi
      .fn()
      .mockResolvedValue({ symbol: 'DAI', balance: '50.00', address: '0xdai', balanceRaw: '0', decimals: 18 }),
    sendToken: vi.fn().mockResolvedValue({ hash: '0xsend', status: 'success', blockNumber: 100 }),
    sendNative: vi.fn().mockResolvedValue({ hash: '0xnative', status: 'success', blockNumber: 101 }),
    swap: vi.fn().mockResolvedValue({ hash: '0xswap', status: 'success', blockNumber: 200 }),
    getTxStatus: vi.fn().mockResolvedValue({ hash: '0xabc', status: 'success', blockNumber: 42 }),
    ...overrides,
  };
}

function makeBinanceInstance(overrides?: Record<string, unknown>) {
  return {
    getBalances: vi.fn().mockResolvedValue([
      { asset: 'BTC', free: '0.01', locked: '0' },
      { asset: 'USDT', free: '100', locked: '0' },
    ]),
    getPositions: vi.fn().mockResolvedValue([]),
    placeOrder: vi.fn().mockResolvedValue({ orderId: 'binance-order-1', status: 'FILLED' }),
    cancelOrder: vi.fn().mockResolvedValue(undefined),
    withdraw: vi.fn().mockResolvedValue('withdraw-id-1'),
    ...overrides,
  };
}

function makeCoinbaseInstance(overrides?: Record<string, unknown>) {
  return {
    getBalances: vi.fn().mockResolvedValue([{ asset: 'BTC', free: '0.005', locked: '0' }]),
    getPositions: vi
      .fn()
      .mockResolvedValue([
        { symbol: 'BTC-USD', side: 'long', size: '0.01', entryPrice: '60000', unrealizedPnl: '+50' },
      ]),
    placeOrder: vi.fn().mockResolvedValue({ orderId: 'cb-order-1', status: 'open' }),
    cancelOrder: vi.fn().mockResolvedValue(undefined),
    withdraw: vi.fn().mockResolvedValue('cb-withdraw-id-1'),
    ...overrides,
  };
}

// ── executeChainAction ────────────────────────────────────────────────────────

describe('executeChainAction', () => {
  let chainInstance: ReturnType<typeof makeChainInstance>;

  beforeEach(() => {
    vi.clearAllMocks();
    chainInstance = makeChainInstance();
    M.chainInstance = chainInstance;
  });

  it('rejects unknown chain action types', async () => {
    const ctx = makeCtx();
    const result = await executeChainAction(ctx, { type: 'navigate', url: 'x' } as any);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unknown chain action');
  });

  describe('chain_get_balance', () => {
    it('returns USDC and native balance', async () => {
      const ctx = makeCtx();
      const result = await executeChainAction(ctx, { type: 'chain_get_balance' } as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('USDC');
        expect(result.value).toContain('ETH');
        expect(result.value).toContain('10.00');
        expect(result.value).toContain('0.5');
      }
    });

    it('passes chainId to ChainClient constructor', async () => {
      const ctx = makeCtx();
      await executeChainAction(ctx, { type: 'chain_get_balance', chainId: 84532 } as any);
      expect(ChainClient).toHaveBeenCalledWith(84532);
    });

    it('returns error when getBalance throws', async () => {
      chainInstance.getBalance.mockRejectedValue(new Error('RPC error'));
      const ctx = makeCtx();
      const result = await executeChainAction(ctx, { type: 'chain_get_balance' } as any);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('RPC error');
    });
  });

  describe('chain_get_token_balance', () => {
    it('returns token balance for given address', async () => {
      const ctx = makeCtx();
      const result = await executeChainAction(ctx, { type: 'chain_get_token_balance', tokenAddress: '0xdai' } as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('DAI');
        expect(result.value).toContain('50.00');
        expect(result.value).toContain('0xdai');
      }
    });

    it('passes tokenAddress to getTokenBalance', async () => {
      const ctx = makeCtx();
      await executeChainAction(ctx, { type: 'chain_get_token_balance', tokenAddress: '0xtoken' } as any);
      expect(chainInstance.getTokenBalance).toHaveBeenCalledWith('0xtoken');
    });
  });

  describe('chain_send_token', () => {
    it('sends token and returns tx hash', async () => {
      const ctx = makeCtx();
      const result = await executeChainAction(ctx, {
        type: 'chain_send_token',
        tokenAddress: '0xusdc',
        to: '0xrecip',
        amount: '5.00',
      } as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('0xsend');
        expect(result.value).toContain('success');
        expect(result.value).toContain('100');
      }
    });

    it('passes correct args to sendToken', async () => {
      const ctx = makeCtx();
      await executeChainAction(ctx, {
        type: 'chain_send_token',
        tokenAddress: '0xusdc',
        to: '0xrecip',
        amount: '5.00',
      } as any);
      expect(chainInstance.sendToken).toHaveBeenCalledWith('0xusdc', '0xrecip', '5.00');
    });

    it('returns error when sendToken throws', async () => {
      chainInstance.sendToken.mockRejectedValue(new Error('Insufficient balance'));
      const ctx = makeCtx();
      const result = await executeChainAction(ctx, {
        type: 'chain_send_token',
        tokenAddress: '0xusdc',
        to: '0xrecip',
        amount: '999',
      } as any);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Insufficient balance');
    });
  });

  describe('chain_swap', () => {
    it('executes swap and returns tx hash', async () => {
      const ctx = makeCtx();
      const result = await executeChainAction(ctx, {
        type: 'chain_swap',
        tokenIn: '0xusdc',
        tokenOut: '0xweth',
        amountIn: '5.0',
        slippageBps: 50,
      } as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('0xswap');
        expect(result.value).toContain('success');
      }
    });

    it('passes swap params including slippageBps', async () => {
      const ctx = makeCtx();
      await executeChainAction(ctx, {
        type: 'chain_swap',
        tokenIn: '0xusdc',
        tokenOut: '0xweth',
        amountIn: '5.0',
        slippageBps: 100,
      } as any);
      expect(chainInstance.swap).toHaveBeenCalledWith({
        tokenIn: '0xusdc',
        tokenOut: '0xweth',
        amountIn: '5.0',
        slippageBps: 100,
      });
    });

    it('returns error when swap throws', async () => {
      chainInstance.swap.mockRejectedValue(new Error('Slippage exceeded'));
      const ctx = makeCtx();
      const result = await executeChainAction(ctx, {
        type: 'chain_swap',
        tokenIn: '0xusdc',
        tokenOut: '0xweth',
        amountIn: '5.0',
      } as any);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Slippage exceeded');
    });
  });

  describe('chain_get_tx_status', () => {
    it('returns tx status and block number', async () => {
      const ctx = makeCtx();
      const result = await executeChainAction(ctx, { type: 'chain_get_tx_status', txHash: '0xabc' } as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('0xabc');
        expect(result.value).toContain('success');
        expect(result.value).toContain('42');
      }
    });

    it('passes txHash to getTxStatus', async () => {
      const ctx = makeCtx();
      await executeChainAction(ctx, { type: 'chain_get_tx_status', txHash: '0xdeadbeef' } as any);
      expect(chainInstance.getTxStatus).toHaveBeenCalledWith('0xdeadbeef');
    });
  });
});

// ── executeCexAction ──────────────────────────────────────────────────────────

describe('executeCexAction', () => {
  let binanceInstance: ReturnType<typeof makeBinanceInstance>;
  let coinbaseInstance: ReturnType<typeof makeCoinbaseInstance>;

  beforeEach(() => {
    vi.clearAllMocks();
    binanceInstance = makeBinanceInstance();
    coinbaseInstance = makeCoinbaseInstance();

    M.binanceInstance = binanceInstance;
    M.coinbaseInstance = coinbaseInstance;

    vi.mocked(FeeService.deductFeeFromAmount).mockImplementation((amount: number) => Math.max(0, amount - 0.4));
  });

  it('rejects unknown CEX action types', async () => {
    const ctx = makeCtx();
    const result = await executeCexAction(ctx, { type: 'navigate', url: 'x' } as any);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Unknown CEX action');
  });

  it('rejects missing exchange field', async () => {
    const ctx = makeCtx();
    const result = await executeCexAction(ctx, { type: 'cex_get_balance' } as any);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('exchange');
  });

  it('rejects invalid exchange value', async () => {
    const ctx = makeCtx();
    const result = await executeCexAction(ctx, { type: 'cex_get_balance', exchange: 'kraken' } as any);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('exchange');
  });

  describe('cex_get_balance', () => {
    it('returns binance balances', async () => {
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, { type: 'cex_get_balance', exchange: 'binance' } as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('binance');
        expect(result.value).toContain('BTC');
        expect(result.value).toContain('USDT');
      }
    });

    it('returns coinbase balances', async () => {
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, { type: 'cex_get_balance', exchange: 'coinbase' } as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('coinbase');
        expect(result.value).toContain('BTC');
      }
    });

    it('returns empty message when no balances', async () => {
      binanceInstance.getBalances.mockResolvedValue([]);
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, { type: 'cex_get_balance', exchange: 'binance' } as any);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toContain('No balances');
    });

    it('returns error when getBalances throws', async () => {
      binanceInstance.getBalances.mockRejectedValue(new Error('API rate limit'));
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, { type: 'cex_get_balance', exchange: 'binance' } as any);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('API rate limit');
    });
  });

  describe('cex_get_positions', () => {
    it('returns positions from coinbase', async () => {
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, { type: 'cex_get_positions', exchange: 'coinbase' } as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('BTC-USD');
        expect(result.value).toContain('long');
      }
    });

    it('returns empty message when no positions', async () => {
      coinbaseInstance.getPositions.mockResolvedValue([]);
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, { type: 'cex_get_positions', exchange: 'coinbase' } as any);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toContain('No open positions');
    });
  });

  describe('cex_place_order', () => {
    it('places market buy on binance', async () => {
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, {
        type: 'cex_place_order',
        exchange: 'binance',
        symbol: 'BTCUSDT',
        side: 'buy',
        orderType: 'market',
        amount: 50,
      } as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('binance-order-1');
        expect(result.value).toContain('BTCUSDT');
        expect(result.value).toContain('buy');
      }
    });

    it('deducts 0.40 fee from order amount', async () => {
      const ctx = makeCtx();
      await executeCexAction(ctx, {
        type: 'cex_place_order',
        exchange: 'binance',
        symbol: 'BTCUSDT',
        side: 'buy',
        orderType: 'market',
        amount: 10,
      } as any);
      // deductFeeFromAmount(10) = 9.6
      expect(binanceInstance.placeOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 9.6 }));
    });

    it('rejects order when amount too small after fee', async () => {
      vi.mocked(FeeService.deductFeeFromAmount).mockReturnValue(0);
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, {
        type: 'cex_place_order',
        exchange: 'binance',
        symbol: 'BTCUSDT',
        side: 'buy',
        orderType: 'market',
        amount: 0.1,
      } as any);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('too small');
    });

    it('passes price for limit orders on coinbase', async () => {
      const ctx = makeCtx();
      await executeCexAction(ctx, {
        type: 'cex_place_order',
        exchange: 'coinbase',
        symbol: 'BTC-USD',
        side: 'sell',
        orderType: 'limit',
        amount: 5,
        price: 70000,
      } as any);
      expect(coinbaseInstance.placeOrder).toHaveBeenCalledWith(
        expect.objectContaining({ price: 70000, orderType: 'limit' })
      );
    });

    it('returns error when placeOrder throws', async () => {
      binanceInstance.placeOrder.mockRejectedValue(new Error('Insufficient funds'));
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, {
        type: 'cex_place_order',
        exchange: 'binance',
        symbol: 'BTCUSDT',
        side: 'buy',
        orderType: 'market',
        amount: 50,
      } as any);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Insufficient funds');
    });
  });

  describe('cex_cancel_order', () => {
    it('cancels order on binance with symbol', async () => {
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, {
        type: 'cex_cancel_order',
        exchange: 'binance',
        orderId: 'order-123',
        symbol: 'BTCUSDT',
      } as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('order-123');
        expect(result.value).toContain('binance');
      }
      expect(binanceInstance.cancelOrder).toHaveBeenCalledWith('BTCUSDT', 'order-123');
    });

    it('cancels order on coinbase without symbol', async () => {
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, {
        type: 'cex_cancel_order',
        exchange: 'coinbase',
        orderId: 'cb-order-456',
      } as any);
      expect(result.ok).toBe(true);
      expect(coinbaseInstance.cancelOrder).toHaveBeenCalledWith('cb-order-456');
    });

    it('returns error when cancelOrder throws', async () => {
      coinbaseInstance.cancelOrder.mockRejectedValue(new Error('Order not found'));
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, {
        type: 'cex_cancel_order',
        exchange: 'coinbase',
        orderId: 'bad-id',
      } as any);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Order not found');
    });
  });

  describe('cex_withdraw', () => {
    it('initiates withdrawal on binance', async () => {
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, {
        type: 'cex_withdraw',
        exchange: 'binance',
        asset: 'USDT',
        amount: 100,
        address: '0xabc',
        network: 'ETH',
      } as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('withdraw-id-1');
        expect(result.value).toContain('binance');
      }
      expect(binanceInstance.withdraw).toHaveBeenCalledWith('USDT', 100, '0xabc', 'ETH');
    });

    it('initiates withdrawal on coinbase', async () => {
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, {
        type: 'cex_withdraw',
        exchange: 'coinbase',
        asset: 'BTC',
        amount: 0.01,
        address: '0xwallet',
        network: 'BTC',
      } as any);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toContain('cb-withdraw-id-1');
    });

    it('returns error when withdraw throws', async () => {
      binanceInstance.withdraw.mockRejectedValue(new Error('Withdrawal disabled'));
      const ctx = makeCtx();
      const result = await executeCexAction(ctx, {
        type: 'cex_withdraw',
        exchange: 'binance',
        asset: 'USDT',
        amount: 100,
        address: '0xabc',
        network: 'ETH',
      } as any);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Withdrawal disabled');
    });
  });
});

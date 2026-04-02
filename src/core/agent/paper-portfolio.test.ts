import { beforeEach, describe, expect, it } from 'vitest';
import {
  _initPaperDbForTest,
  adjustPaperBalance,
  estimateLiquidity,
  getPaperBalance,
  getPaperBalances,
  getPaperPortfolioSummary,
  getPaperTrades,
  recordPaperTrade,
  recordRealisticPaperSwap,
  resetPaperPortfolio,
  simulateRealisticSwap,
} from './paper-portfolio';

beforeEach(() => {
  _initPaperDbForTest();
});

// ── Auto-seed ────────────────────────────────────────────────────────────────

describe('auto-seed', () => {
  it('seeds 10k USDC on first getPaperBalance call', () => {
    const bal = getPaperBalance('USDC');
    expect(bal).toBe(10_000);
  });

  it('returns 0 for unknown asset without seeding extra rows', () => {
    const bal = getPaperBalance('BTC');
    expect(bal).toBe(0);
  });

  it('only seeds once even after multiple calls', () => {
    getPaperBalance('USDC');
    getPaperBalance('ETH');
    const balances = getPaperBalances();
    const usdcRows = balances.filter((b) => b.asset === 'USDC');
    expect(usdcRows).toHaveLength(1);
    expect(usdcRows[0].amount).toBe(10_000);
  });
});

// ── getPaperBalances ──────────────────────────────────────────────────────────

describe('getPaperBalances', () => {
  it('returns only balances > 0', () => {
    adjustPaperBalance('USDC', -10_000); // zero out USDC
    adjustPaperBalance('ETH', 0.5);
    const bals = getPaperBalances();
    expect(bals.some((b) => b.asset === 'USDC')).toBe(false);
    expect(bals.some((b) => b.asset === 'ETH')).toBe(true);
  });

  it('returns balances sorted by asset', () => {
    adjustPaperBalance('ZRX', 1);
    adjustPaperBalance('AAVE', 2);
    const assets = getPaperBalances().map((b) => b.asset);
    expect(assets).toEqual([...assets].sort());
  });
});

// ── adjustPaperBalance ────────────────────────────────────────────────────────

describe('adjustPaperBalance', () => {
  it('increases balance', () => {
    adjustPaperBalance('ETH', 1.5);
    expect(getPaperBalance('ETH')).toBe(1.5);
  });

  it('decreases balance', () => {
    getPaperBalance('USDC'); // seed
    adjustPaperBalance('USDC', -500);
    expect(getPaperBalance('USDC')).toBe(9_500);
  });

  it('creates asset row if not present', () => {
    adjustPaperBalance('SOL', 10);
    expect(getPaperBalance('SOL')).toBe(10);
  });

  it('accumulates multiple adjustments', () => {
    adjustPaperBalance('ETH', 1);
    adjustPaperBalance('ETH', 2);
    adjustPaperBalance('ETH', -0.5);
    expect(getPaperBalance('ETH')).toBeCloseTo(2.5);
  });
});

// ── recordPaperTrade ──────────────────────────────────────────────────────────

describe('recordPaperTrade', () => {
  it('returns a paper- prefixed orderId', () => {
    const id = recordPaperTrade({ venue: 'binance', action_type: 'cex_place_order' });
    expect(id).toMatch(/^paper-\d+-[a-z0-9]+$/);
  });

  it('persists trade in DB', () => {
    recordPaperTrade({
      venue: 'binance',
      action_type: 'cex_place_order',
      symbol: 'BTC/USDT',
      side: 'buy',
      price: 60_000,
      size: 0.01,
      amount_usd: 600,
    });
    const trades = getPaperTrades();
    expect(trades).toHaveLength(1);
    expect(trades[0].symbol).toBe('BTC/USDT');
    expect(trades[0].status).toBe('FILLED');
  });

  it('generates unique orderIds', () => {
    const ids = new Set(
      Array.from({ length: 5 }, () => recordPaperTrade({ venue: 'chain', action_type: 'chain_swap' }))
    );
    expect(ids.size).toBe(5);
  });
});

// ── getPaperTrades ────────────────────────────────────────────────────────────

describe('getPaperTrades', () => {
  it('returns trades newest first', () => {
    recordPaperTrade({ venue: 'binance', action_type: 'cex_place_order' });
    recordPaperTrade({ venue: 'coinbase', action_type: 'cex_place_order' });
    const trades = getPaperTrades();
    expect(trades[0].venue).toBe('coinbase');
    expect(trades[1].venue).toBe('binance');
  });

  it('filters by venue', () => {
    recordPaperTrade({ venue: 'binance', action_type: 'cex_place_order' });
    recordPaperTrade({ venue: 'polymarket', action_type: 'polymarket_place_order' });
    const bTrades = getPaperTrades({ venue: 'binance' });
    expect(bTrades).toHaveLength(1);
    expect(bTrades[0].venue).toBe('binance');
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) recordPaperTrade({ venue: 'chain', action_type: 'chain_swap' });
    const trades = getPaperTrades({ limit: 3 });
    expect(trades).toHaveLength(3);
  });
});

// ── getPaperPortfolioSummary ──────────────────────────────────────────────────

describe('getPaperPortfolioSummary', () => {
  it('includes balances, totalUsd, tradeCount, recentTrades', () => {
    const summary = getPaperPortfolioSummary();
    expect(summary.balances).toBeDefined();
    expect(summary.totalUsd).toBe(10_000);
    expect(summary.tradeCount).toBe(0);
    expect(summary.recentTrades).toHaveLength(0);
  });

  it('reflects updated state after trades', () => {
    adjustPaperBalance('USDC', -1000);
    recordPaperTrade({ venue: 'binance', action_type: 'cex_place_order' });
    const summary = getPaperPortfolioSummary();
    expect(summary.totalUsd).toBe(9_000);
    expect(summary.tradeCount).toBe(1);
    expect(summary.recentTrades).toHaveLength(1);
  });

  it('counts USDT and DAI as USD', () => {
    adjustPaperBalance('USDT', 500);
    adjustPaperBalance('DAI', 250);
    const summary = getPaperPortfolioSummary();
    expect(summary.totalUsd).toBe(10_750);
  });
});

// ── resetPaperPortfolio ───────────────────────────────────────────────────────

describe('resetPaperPortfolio', () => {
  it('resets balances and trades to default 10k USDC', () => {
    adjustPaperBalance('ETH', 5);
    recordPaperTrade({ venue: 'chain', action_type: 'chain_swap' });
    resetPaperPortfolio();
    expect(getPaperBalance('USDC')).toBe(10_000);
    expect(getPaperBalance('ETH')).toBe(0);
    expect(getPaperTrades()).toHaveLength(0);
  });

  it('accepts custom starting balance', () => {
    resetPaperPortfolio(50_000);
    expect(getPaperBalance('USDC')).toBe(50_000);
  });

  it('clears all trades', () => {
    for (let i = 0; i < 3; i++) recordPaperTrade({ venue: 'binance', action_type: 'cex_place_order' });
    resetPaperPortfolio();
    expect(getPaperTrades()).toHaveLength(0);
  });
});

// ── Realistic Swap Simulation ─────────────────────────────────────────────────

describe('simulateRealisticSwap', () => {
  it('applies DEX fee based on token type', async () => {
    const result = await simulateRealisticSwap({
      tokenIn: 'USDC',
      tokenOut: 'PEPE', // PEPE is a meme coin = 1% fee
      amountIn: 100,
      liquidityUsd: 1_000_000,
    });

    expect(result.dexFeePercent).toBe(1.0); // Meme coins use 1% tier
    expect(result.details).toContain('DEX fee');
  });

  it('calculates slippage based on trade size vs liquidity', async () => {
    // Small trade (0.1% of liquidity) - low slippage
    const small = await simulateRealisticSwap({
      tokenIn: 'USDC',
      tokenOut: 'PEPE',
      amountIn: 100,
      liquidityUsd: 1_000_000,
    });
    expect(small.slippagePercent).toBeLessThan(1.0);

    // Large trade (5% of liquidity) - high slippage
    const large = await simulateRealisticSwap({
      tokenIn: 'USDC',
      tokenOut: 'PEPE',
      amountIn: 50_000,
      liquidityUsd: 1_000_000,
    });
    expect(large.slippagePercent).toBeGreaterThan(1.0);
  });

  it('caps slippage at reasonable maximum', async () => {
    const result = await simulateRealisticSwap({
      tokenIn: 'USDC',
      tokenOut: 'PEPE',
      amountIn: 500_000, // 50% of liquidity - very high!
      liquidityUsd: 1_000_000,
    });

    expect(result.slippagePercent).toBeLessThanOrEqual(8.0);
  });

  it('applies gas costs by chain', async () => {
    const base = await simulateRealisticSwap({
      tokenIn: 'USDC',
      tokenOut: 'PEPE',
      amountIn: 100,
      chainId: 'base',
    });
    expect(base.gasCostUsd).toBe(0.02);

    const eth = await simulateRealisticSwap({
      tokenIn: 'USDC',
      tokenOut: 'PEPE',
      amountIn: 100,
      chainId: 'ethereum',
    });
    expect(eth.gasCostUsd).toBe(0.08);

    const sol = await simulateRealisticSwap({
      tokenIn: 'USDC',
      tokenOut: 'PEPE',
      amountIn: 100,
      chainId: 'solana',
    });
    expect(sol.gasCostUsd).toBe(0.005);
  });

  it('output is less than input due to fees and slippage', async () => {
    const result = await simulateRealisticSwap({
      tokenIn: 'USDC',
      tokenOut: 'PEPE',
      amountIn: 100,
      liquidityUsd: 500_000,
    });

    // Should lose ~0.5-4% due to fees + slippage (high liquidity = lower slippage)
    expect(result.amountOut).toBeLessThan(99.5); // At least 0.5% cost
    expect(result.amountOut).toBeGreaterThan(95); // But not more than 5%
  });

  it('includes execution delay of 10-30 seconds', async () => {
    const result = await simulateRealisticSwap({
      tokenIn: 'USDC',
      tokenOut: 'PEPE',
      amountIn: 100,
    });

    expect(result.executionDelayMs).toBeGreaterThanOrEqual(10000);
    expect(result.executionDelayMs).toBeLessThanOrEqual(30000);
  });

  it('generates detailed cost breakdown', async () => {
    const result = await simulateRealisticSwap({
      tokenIn: 'USDC',
      tokenOut: 'PEPE',
      amountIn: 100,
    });

    expect(result.details).toContain('DEX fee');
    expect(result.details).toContain('Slippage');
    expect(result.details).toContain('Price impact');
    expect(result.details).toContain('Gas fee');
  });
});

// ── estimateLiquidity ─────────────────────────────────────────────────────────

describe('estimateLiquidity', () => {
  it('returns high liquidity for USDC pairs ($500K-$1.5M)', () => {
    const usdcPair = estimateLiquidity('USDC', 'PEPE');
    expect(usdcPair).toBeGreaterThanOrEqual(500_000);
    expect(usdcPair).toBeLessThanOrEqual(1_500_000);
  });

  it('returns high liquidity for ETH pairs ($1M-$3M)', () => {
    const ethPair = estimateLiquidity('WETH', 'PEPE');
    expect(ethPair).toBeGreaterThanOrEqual(1_000_000);
    expect(ethPair).toBeLessThanOrEqual(3_000_000);
  });

  it('returns lower liquidity for non-stable pairs ($50K-$200K)', () => {
    const memePair = estimateLiquidity('PEPE', 'SHIB');
    expect(memePair).toBeGreaterThanOrEqual(50_000);
    expect(memePair).toBeLessThanOrEqual(200_000);
  });
});

// ── recordRealisticPaperSwap ─────────────────────────────────────────────────

describe('recordRealisticPaperSwap', () => {
  it('adjusts balances with realistic amounts', async () => {
    const initialUsdc = getPaperBalance('USDC'); // 10,000

    const result = await recordRealisticPaperSwap('task-1', 'USDC', 'PEPE', 1000, 'base');

    // USDC should decrease by 1000
    expect(getPaperBalance('USDC')).toBeCloseTo(initialUsdc - 1000, 0);

    // PEPE should increase by ~965-995 (minus fees/slippage)
    expect(getPaperBalance('PEPE')).toBeGreaterThan(965);
    expect(getPaperBalance('PEPE')).toBeLessThan(995);

    expect(result.amountOut).toBe(getPaperBalance('PEPE'));
  });

  it('records trade with detailed info', async () => {
    await recordRealisticPaperSwap('task-2', 'USDC', 'PEPE', 500, 'base');

    const trades = getPaperTrades({ limit: 1 });
    expect(trades).toHaveLength(1);
    expect(trades[0].action_type).toBe('chain_swap_realistic');
    expect(trades[0].venue).toContain('chain:base');
    expect(trades[0].symbol).toBe('USDC->PEPE');
  });

  it('returns orderId with simulation details', async () => {
    const result = await recordRealisticPaperSwap('task-3', 'USDC', 'SHIB', 200);

    expect(result.orderId).toMatch(/^paper-\d+-[a-z0-9]+$/);
    expect(result.slippagePercent).toBeGreaterThan(0);
    expect(result.dexFeePercent).toBe(1.0); // SHIB is meme coin = 1% fee
    expect(result.details).toContain('Gas fee'); // New format uses "Gas fee" instead of "Total Cost:"
    expect(result.details).toContain('DEX fee');
  });

  it('applies different costs for different trade sizes', async () => {
    // Small trade - lower slippage
    const small = await recordRealisticPaperSwap('task-4', 'USDC', 'TOKEN', 100);

    // Large trade - higher slippage (low liquidity)
    const large = await recordRealisticPaperSwap('task-5', 'USDC', 'TOKEN', 10000);

    // Large trade should have worse ratio due to slippage
    const smallRatio = small.amountOut / 100;
    const largeRatio = large.amountOut / 10000;

    expect(largeRatio).toBeLessThan(smallRatio);
  });
});

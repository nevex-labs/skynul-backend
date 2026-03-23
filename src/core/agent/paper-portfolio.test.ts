import { describe, it, expect, beforeEach } from 'vitest';
import {
  _initPaperDbForTest,
  getPaperBalance,
  getPaperBalances,
  adjustPaperBalance,
  recordPaperTrade,
  getPaperTrades,
  getPaperPortfolioSummary,
  resetPaperPortfolio,
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

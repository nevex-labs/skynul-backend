import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractTradesFromTask,
  computeScore,
  saveTradeScore,
  getTaskScore,
  getPerformanceSummary,
  formatPerformanceForPrompt,
  buildFeedbackContext,
  _initEvalDbForTest,
} from './eval-feedback';
import type { ScoreInput, ExtractedTrade } from './eval-feedback';
import type { Task, TaskStep } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_test',
    prompt: 'trade BTC',
    status: 'completed',
    mode: 'code',
    runner: 'cdp',
    capabilities: ['polymarket.trading'],
    steps: [],
    maxSteps: 50,
    timeoutMs: 300000,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  } as Task;
}

function makeStep(overrides: Partial<TaskStep> & { action: TaskStep['action'] }): TaskStep {
  return {
    index: 0,
    timestamp: Date.now(),
    screenshotBase64: '',
    ...overrides,
  };
}

function makePolymarketTask(opts: {
  hasTrade?: boolean;
  hasClose?: boolean;
  openPositionsAtEnd?: boolean;
  status?: Task['status'];
  stepsUsed?: number;
}): Task {
  const steps: TaskStep[] = [];

  if (opts.hasTrade !== false) {
    steps.push(makeStep({
      index: 0,
      action: {
        type: 'polymarket_place_order',
        tokenId: 'token123abc456def',
        side: 'buy',
        price: 0.65,
        size: 10,
      },
      result: 'Order placed (GTC): buy 10 @ $0.65 on token123abc...',
    }));

    if (opts.hasClose) {
      steps.push(makeStep({
        index: 1,
        action: { type: 'polymarket_get_account_summary' },
        result: 'Balance: $1000.00, 0 positions.',
      }));
      steps.push(makeStep({
        index: 2,
        action: {
          type: 'polymarket_close_position',
          tokenId: 'token123abc456def',
        },
        result: 'Position closed: token123abc... size=full',
      }));
      steps.push(makeStep({
        index: 3,
        action: { type: 'polymarket_get_account_summary' },
        result: 'Balance: $1006.50, 0 positions.',
      }));
    } else if (opts.openPositionsAtEnd) {
      steps.push(makeStep({
        index: 1,
        action: { type: 'polymarket_get_account_summary' },
        result: 'Balance: $993.50, 1 positions.\n  BTC above 100k [YES] 10 shares @ $0.65, PnL $-6.50',
      }));
    } else {
      steps.push(makeStep({
        index: 1,
        action: { type: 'polymarket_get_account_summary' },
        result: 'Balance: $993.50, 0 positions.',
      }));
    }
  }

  steps.push(makeStep({
    index: steps.length,
    action: { type: 'done', summary: 'Trading complete' },
  }));

  return makeTask({
    capabilities: ['polymarket.trading'],
    status: opts.status ?? 'completed',
    steps,
    maxSteps: opts.stepsUsed ? opts.stepsUsed * 2 : 50,
  });
}

function makeCexTask(): Task {
  const steps: TaskStep[] = [
    makeStep({
      index: 0,
      action: {
        type: 'cex_place_order',
        exchange: 'binance',
        symbol: 'BTCUSDT',
        side: 'buy',
        orderType: 'market',
        amount: 100,
      },
      result: 'Order placed on binance: buy 99.6 BTCUSDT | orderId: ord123 | status: filled',
    }),
    makeStep({
      index: 1,
      action: { type: 'done', summary: 'Done' },
    }),
  ];
  return makeTask({ capabilities: ['cex.trading'], steps, status: 'completed' });
}

function makeNonTradingTask(): Task {
  const steps: TaskStep[] = [
    makeStep({
      index: 0,
      action: { type: 'file_read', path: 'src/index.ts' },
      result: 'file content...',
    }),
    makeStep({
      index: 1,
      action: { type: 'done', summary: 'Done reading' },
    }),
  ];
  return makeTask({ capabilities: [], steps });
}

function makeScoreInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  const trade: ExtractedTrade = {
    symbol: 'BTCUSDT',
    side: 'buy',
    entryPrice: 0.65,
    exitPrice: 0.75,
    size: 10,
    pnlUsd: 1.0,
  };
  return {
    task: makePolymarketTask({ hasTrade: true }),
    venue: 'polymarket',
    capability: 'polymarket.trading',
    trades: [trade],
    durationMs: 30000,
    isPaper: false,
    ...overrides,
  };
}

// ── Phase 1: extractTradesFromTask ────────────────────────────────────────────

describe('extractTradesFromTask', () => {
  it('returns null for non-trading task (no trading capabilities)', () => {
    const task = makeNonTradingTask();
    expect(extractTradesFromTask(task)).toBeNull();
  });

  it('returns null for task with no trade actions even with trading capability', () => {
    const task = makeTask({
      capabilities: ['polymarket.trading'],
      steps: [makeStep({ action: { type: 'done', summary: 'nothing done' } })],
    });
    expect(extractTradesFromTask(task)).toBeNull();
  });

  it('extracts polymarket venue from polymarket.trading capability', () => {
    const task = makePolymarketTask({ hasTrade: true });
    const result = extractTradesFromTask(task);
    expect(result).not.toBeNull();
    expect(result!.venue).toBe('polymarket');
    expect(result!.capability).toBe('polymarket.trading');
  });

  it('extracts trade with correct entry price and size from place_order action', () => {
    const task = makePolymarketTask({ hasTrade: true });
    const result = extractTradesFromTask(task);
    expect(result!.trades.length).toBeGreaterThan(0);
    const trade = result!.trades[0];
    expect(trade.entryPrice).toBe(0.65);
    expect(trade.size).toBe(10);
    expect(trade.side).toBe('buy');
    expect(trade.symbol).toContain('token123');
  });

  it('detects hadOpenPositionsAtDone when last summary before done shows positions', () => {
    const task = makePolymarketTask({ hasTrade: true, openPositionsAtEnd: true });
    const result = extractTradesFromTask(task);
    expect(result).not.toBeNull();
    expect(result!.hadOpenPositionsAtDone).toBe(true);
  });

  it('sets hadOpenPositionsAtDone=false when last summary shows 0 positions', () => {
    const task = makePolymarketTask({ hasTrade: true, openPositionsAtEnd: false });
    const result = extractTradesFromTask(task);
    expect(result!.hadOpenPositionsAtDone).toBe(false);
  });

  it('extracts CEX venue from cex.trading capability', () => {
    const task = makeCexTask();
    const result = extractTradesFromTask(task);
    expect(result).not.toBeNull();
    expect(result!.venue).toBe('cex_binance');
    expect(result!.capability).toBe('cex.trading');
  });

  it('extracts CEX trade with symbol and side from cex_place_order', () => {
    const task = makeCexTask();
    const result = extractTradesFromTask(task);
    expect(result!.trades.length).toBeGreaterThan(0);
    const trade = result!.trades[0];
    expect(trade.symbol).toBe('BTCUSDT');
    expect(trade.side).toBe('buy');
    expect(trade.size).toBeGreaterThan(0);
  });

  it('extracts onchain venue from onchain.trading capability', () => {
    const steps: TaskStep[] = [
      makeStep({
        index: 0,
        action: {
          type: 'chain_swap',
          tokenIn: 'USDC',
          tokenOut: 'WETH',
          amountIn: '100',
        },
        result: 'Swap executed. Tx: 0xabc123 | Status: success | Block: 12345',
      }),
      makeStep({ index: 1, action: { type: 'done', summary: 'Done' } }),
    ];
    const task = makeTask({ capabilities: ['onchain.trading'], steps });
    const result = extractTradesFromTask(task);
    expect(result).not.toBeNull();
    expect(result!.venue).toBe('onchain');
    expect(result!.capability).toBe('onchain.trading');
    expect(result!.trades[0].symbol).toBe('USDC→WETH');
  });
});

// ── Phase 1: computeScore ─────────────────────────────────────────────────────

describe('computeScore', () => {
  it('returns scorePnl > 0.5 for profitable trade', () => {
    const input = makeScoreInput({
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 1.1, size: 100, pnlUsd: 10 }],
    });
    const { scorePnl } = computeScore(input);
    expect(scorePnl).toBeGreaterThan(0.5);
  });

  it('returns scorePnl = 0.3 for breakeven trade', () => {
    const input = makeScoreInput({
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 1, size: 100, pnlUsd: 0 }],
    });
    const { scorePnl } = computeScore(input);
    expect(scorePnl).toBeCloseTo(0.3, 1);
  });

  it('returns scorePnl < 0.3 for losing trade', () => {
    const input = makeScoreInput({
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 0.9, size: 100, pnlUsd: -10 }],
    });
    const { scorePnl } = computeScore(input);
    expect(scorePnl).toBeLessThan(0.3);
  });

  it('clamps scorePnl to 1.0 for very large gains', () => {
    const input = makeScoreInput({
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 3, size: 100, pnlUsd: 200 }],
    });
    const { scorePnl } = computeScore(input);
    expect(scorePnl).toBeLessThanOrEqual(1.0);
  });

  it('clamps scorePnl to 0.0 for catastrophic loss', () => {
    const input = makeScoreInput({
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 0, size: 100, pnlUsd: -100 }],
    });
    const { scorePnl } = computeScore(input);
    expect(scorePnl).toBeGreaterThanOrEqual(0.0);
  });

  it('returns scoreDiscipline = 1.0 for completed task with no violations', () => {
    const input = makeScoreInput({
      task: makeTask({ status: 'completed' }),
      hadOpenPositionsAtDone: false,
    });
    const { scoreDiscipline } = computeScore(input);
    expect(scoreDiscipline).toBe(1.0);
  });

  it('reduces scoreDiscipline by 0.4 when hadOpenPositionsAtDone', () => {
    const input = makeScoreInput({
      task: makeTask({ status: 'completed' }),
      hadOpenPositionsAtDone: true,
    });
    const { scoreDiscipline } = computeScore(input);
    expect(scoreDiscipline).toBeCloseTo(0.6, 5);
  });

  it('reduces scoreDiscipline by 0.2 for failed task', () => {
    const input = makeScoreInput({
      task: makeTask({ status: 'failed' }),
      hadOpenPositionsAtDone: false,
    });
    const { scoreDiscipline } = computeScore(input);
    expect(scoreDiscipline).toBeCloseTo(0.8, 5);
  });

  it('returns scoreEfficiency near 1.0 when task used few steps (completed)', () => {
    const task = makeTask({ status: 'completed', maxSteps: 50 });
    task.steps = [makeStep({ action: { type: 'done', summary: 'd' } })]; // 1 step used
    const input = makeScoreInput({ task, stepsUsed: 1 });
    const { scoreEfficiency } = computeScore(input);
    expect(scoreEfficiency).toBeGreaterThan(0.9);
  });

  it('returns lower scoreEfficiency when task used many steps (completed)', () => {
    const task = makeTask({ status: 'completed', maxSteps: 50 });
    task.steps = Array.from({ length: 50 }, (_, i) => makeStep({ index: i, action: { type: 'wait', ms: 100 } }));
    const input = makeScoreInput({ task, stepsUsed: 50 });
    const { scoreEfficiency } = computeScore(input);
    expect(scoreEfficiency).toBeLessThan(0.8);
  });

  it('returns scoreEfficiency near 0 for failed task that used all steps', () => {
    const task = makeTask({ status: 'failed', maxSteps: 50 });
    task.steps = Array.from({ length: 50 }, (_, i) => makeStep({ index: i, action: { type: 'wait', ms: 100 } }));
    const input = makeScoreInput({ task, stepsUsed: 50 });
    const { scoreEfficiency } = computeScore(input);
    expect(scoreEfficiency).toBeLessThanOrEqual(0.3);
  });

  it('returns scoreTotal as weighted combination of three dimensions', () => {
    const input = makeScoreInput({
      task: makeTask({ status: 'completed', maxSteps: 50 }),
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 1.1, size: 100, pnlUsd: 10 }],
      hadOpenPositionsAtDone: false,
      stepsUsed: 5,
    });
    const { scorePnl, scoreDiscipline, scoreEfficiency, scoreTotal } = computeScore(input);
    const expected = (scorePnl * 0.40) + (scoreDiscipline * 0.35) + (scoreEfficiency * 0.25);
    expect(scoreTotal).toBeCloseTo(expected, 5);
  });

  it('clamps all scores to [0.0, 1.0]', () => {
    const input = makeScoreInput({
      task: makeTask({ status: 'failed' }),
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 0, size: 100, pnlUsd: -100 }],
      hadOpenPositionsAtDone: true,
    });
    const { scorePnl, scoreDiscipline, scoreEfficiency, scoreTotal } = computeScore(input);
    expect(scorePnl).toBeGreaterThanOrEqual(0.0);
    expect(scorePnl).toBeLessThanOrEqual(1.0);
    expect(scoreDiscipline).toBeGreaterThanOrEqual(0.0);
    expect(scoreDiscipline).toBeLessThanOrEqual(1.0);
    expect(scoreEfficiency).toBeGreaterThanOrEqual(0.0);
    expect(scoreEfficiency).toBeLessThanOrEqual(1.0);
    expect(scoreTotal).toBeGreaterThanOrEqual(0.0);
    expect(scoreTotal).toBeLessThanOrEqual(1.0);
  });
});

// ── Phase 1: saveTradeScore / getTaskScore ────────────────────────────────────

describe('saveTradeScore / getTaskScore', () => {
  beforeEach(() => {
    _initEvalDbForTest();
  });

  it('inserts a trade score and returns id > 0', () => {
    const input = makeScoreInput();
    const id = saveTradeScore(input);
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('returns null for non-existent task', () => {
    expect(getTaskScore('task_nonexistent')).toBeNull();
  });

  it('returns full TradeScore for scored task', () => {
    const input = makeScoreInput({
      task: makeTask({ id: 'task_scored' }),
      venue: 'polymarket',
    });
    saveTradeScore(input);
    const score = getTaskScore('task_scored');
    expect(score).not.toBeNull();
    expect(score!.taskId).toBe('task_scored');
    expect(score!.venue).toBe('polymarket');
    expect(typeof score!.scoreTotal).toBe('number');
  });

  it('stores isPaper flag correctly', () => {
    const input = makeScoreInput({
      task: makeTask({ id: 'task_paper' }),
      isPaper: true,
    });
    saveTradeScore(input);
    const score = getTaskScore('task_paper');
    expect(score!.isPaper).toBe(true);
  });

  it('rejects duplicate task_id (UNIQUE constraint)', () => {
    const input = makeScoreInput({ task: makeTask({ id: 'task_dup' }) });
    saveTradeScore(input);
    expect(() => saveTradeScore(input)).toThrow();
  });

  it('stores correct score dimensions', () => {
    const input = makeScoreInput({
      task: makeTask({ id: 'task_dims', status: 'completed' }),
      trades: [{ symbol: 'T', side: 'buy', entryPrice: 1, exitPrice: 1.1, size: 100, pnlUsd: 10 }],
    });
    saveTradeScore(input);
    const score = getTaskScore('task_dims');
    expect(score!.scorePnl).toBeGreaterThan(0.5);
    expect(score!.scoreDiscipline).toBe(1.0);
    expect(score!.scoreTotal).toBeGreaterThan(0);
  });
});

// ── Phase 2: getPerformanceSummary ────────────────────────────────────────────

describe('getPerformanceSummary', () => {
  beforeEach(() => {
    _initEvalDbForTest();
  });

  it('returns zeroed summary when no trades exist', () => {
    const summary = getPerformanceSummary();
    expect(summary.totalTasks).toBe(0);
    expect(summary.winRate).toBe(0);
    expect(summary.totalPnlUsd).toBe(0);
  });

  it('calculates correct winRate from mix of profitable and losing trades', () => {
    // 2 wins, 1 loss
    saveTradeScore(makeScoreInput({
      task: makeTask({ id: 't1' }),
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 1.1, size: 10, pnlUsd: 1.0 }],
    }));
    saveTradeScore(makeScoreInput({
      task: makeTask({ id: 't2' }),
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 1.2, size: 10, pnlUsd: 2.0 }],
    }));
    saveTradeScore(makeScoreInput({
      task: makeTask({ id: 't3' }),
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 0.9, size: 10, pnlUsd: -1.0 }],
    }));
    const summary = getPerformanceSummary();
    expect(summary.totalTasks).toBe(3);
    expect(summary.winRate).toBeCloseTo(2 / 3, 1);
  });

  it('sums totalPnlUsd correctly', () => {
    saveTradeScore(makeScoreInput({
      task: makeTask({ id: 'p1' }),
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 1.1, size: 10, pnlUsd: 5.0 }],
    }));
    saveTradeScore(makeScoreInput({
      task: makeTask({ id: 'p2' }),
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 0.9, size: 10, pnlUsd: -2.0 }],
    }));
    const summary = getPerformanceSummary();
    expect(summary.totalPnlUsd).toBeCloseTo(3.0, 1);
  });

  it('filters by venue', () => {
    saveTradeScore(makeScoreInput({
      task: makeTask({ id: 'v1' }),
      venue: 'polymarket',
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 1.1, size: 10, pnlUsd: 1 }],
    }));
    saveTradeScore(makeScoreInput({
      task: makeTask({ id: 'v2' }),
      venue: 'cex_binance',
      trades: [{ symbol: 'Y', side: 'buy', entryPrice: 1, exitPrice: 1.1, size: 10, pnlUsd: 1 }],
    }));
    const poly = getPerformanceSummary({ venue: 'polymarket' });
    expect(poly.totalTasks).toBe(1);
  });

  it('filters by paperOnly', () => {
    saveTradeScore(makeScoreInput({
      task: makeTask({ id: 'live1' }),
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 1.1, size: 10, pnlUsd: 1 }],
      isPaper: false,
    }));
    saveTradeScore(makeScoreInput({
      task: makeTask({ id: 'paper1' }),
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 1.1, size: 10, pnlUsd: 1 }],
      isPaper: true,
    }));
    const paperSummary = getPerformanceSummary({ paperOnly: true });
    expect(paperSummary.totalTasks).toBe(1);
    const liveSummary = getPerformanceSummary({ paperOnly: false });
    expect(liveSummary.totalTasks).toBe(1);
  });

  it('returns recentTasks limited by limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      saveTradeScore(makeScoreInput({
        task: makeTask({ id: `rt${i}` }),
        trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 1.1, size: 10, pnlUsd: 1 }],
      }));
    }
    const summary = getPerformanceSummary({ limit: 3 });
    expect(summary.recentTasks.length).toBeLessThanOrEqual(3);
  });
});

// ── Phase 3: formatPerformanceForPrompt / buildFeedbackContext ─────────────────

describe('formatPerformanceForPrompt', () => {
  it('returns empty string when totalTasks is 0', () => {
    const summary = getPerformanceSummary(); // empty db not needed, just use zeroed
    // manually create zeroed summary
    expect(formatPerformanceForPrompt({
      totalTasks: 0,
      winRate: 0,
      totalPnlUsd: 0,
      avgScoreTotal: 0,
      avgScoreDiscipline: 0,
      avgScoreEfficiency: 0,
      recentTasks: [],
      byVenue: {} as any,
    })).toBe('');
  });

  it('includes win rate and total PnL', () => {
    const result = formatPerformanceForPrompt({
      totalTasks: 10,
      winRate: 0.6,
      totalPnlUsd: 47.2,
      avgScoreTotal: 0.71,
      avgScoreDiscipline: 0.82,
      avgScoreEfficiency: 0.65,
      recentTasks: [],
      byVenue: {} as any,
    });
    expect(result).toContain('60%');
    expect(result).toContain('47.2');
  });

  it('includes discipline weakness warning when avgScoreDiscipline < 0.7', () => {
    const result = formatPerformanceForPrompt({
      totalTasks: 5,
      winRate: 0.5,
      totalPnlUsd: 0,
      avgScoreTotal: 0.5,
      avgScoreDiscipline: 0.4,
      avgScoreEfficiency: 0.7,
      recentTasks: [],
      byVenue: {} as any,
    });
    expect(result.toLowerCase()).toMatch(/position|discipline|open/i);
  });
});

describe('buildFeedbackContext', () => {
  beforeEach(() => {
    _initEvalDbForTest();
  });

  it('returns empty string for non-trading capabilities', () => {
    const result = buildFeedbackContext([]);
    expect(result).toBe('');
  });

  it('returns empty string for code-only capabilities', () => {
    const result = buildFeedbackContext(['app.scripting']);
    expect(result).toBe('');
  });

  it('returns empty string when no prior trades exist', () => {
    const result = buildFeedbackContext(['polymarket.trading']);
    expect(result).toBe('');
  });

  it('returns formatted block when trading history exists', () => {
    saveTradeScore(makeScoreInput({
      task: makeTask({ id: 'fb1' }),
      trades: [{ symbol: 'X', side: 'buy', entryPrice: 1, exitPrice: 1.1, size: 10, pnlUsd: 5 }],
    }));
    const result = buildFeedbackContext(['polymarket.trading']);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('PERFORMANCE');
  });
});

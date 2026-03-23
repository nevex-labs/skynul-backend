import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ParserState, parseModelResponse } from './action-parser';

describe('parseModelResponse', () => {
  describe('clean JSON', () => {
    it('parses simple click action', () => {
      const result = parseModelResponse('{"thought":"click the button","action":{"type":"click","x":100,"y":200}}');
      expect(result.thought).toBe('click the button');
      expect(result.action).toEqual({ type: 'click', x: 100, y: 200 });
    });

    it('parses done action', () => {
      const result = parseModelResponse('{"action":{"type":"done","summary":"Task completed"}}');
      expect(result.action).toEqual({ type: 'done', summary: 'Task completed' });
    });

    it('parses fail action', () => {
      const result = parseModelResponse('{"action":{"type":"fail","reason":"Element not found"}}');
      expect(result.action).toEqual({ type: 'fail', reason: 'Element not found' });
    });

    it('parses without thought field', () => {
      const result = parseModelResponse('{"action":{"type":"done","summary":"ok"}}');
      expect(result.action).toEqual({ type: 'done', summary: 'ok' });
    });

    it('parses type action', () => {
      const result = parseModelResponse('{"action":{"type":"type","text":"hello world"}}');
      expect(result.action).toEqual({ type: 'type', text: 'hello world' });
    });

    it('parses navigate action', () => {
      const result = parseModelResponse('{"action":{"type":"navigate","url":"https://example.com"}}');
      expect(result.action).toEqual({ type: 'navigate', url: 'https://example.com' });
    });

    it('parses shell action', () => {
      const result = parseModelResponse('{"action":{"type":"shell","command":"ls -la"}}');
      expect(result.action).toEqual({ type: 'shell', command: 'ls -la' });
    });

    it('parses task_send action', () => {
      const result = parseModelResponse(
        '{"action":{"type":"task_send","prompt":"do something","agentRole":"Research"}}'
      );
      expect(result.action).toEqual({ type: 'task_send', prompt: 'do something', agentRole: 'Research' });
    });

    it('parses generate_image action', () => {
      const result = parseModelResponse('{"action":{"type":"generate_image","prompt":"a cat","size":"1024x1024"}}');
      expect(result.action).toEqual({ type: 'generate_image', prompt: 'a cat', size: '1024x1024' });
    });
  });

  describe('markdown code fences', () => {
    it('parses json code fence', () => {
      const result = parseModelResponse('```json\n{"action":{"type":"done","summary":"ok"}}\n```');
      expect(result.action).toEqual({ type: 'done', summary: 'ok' });
    });

    it('parses code fence without json tag', () => {
      const result = parseModelResponse('```\n{"action":{"type":"done","summary":"ok"}}\n```');
      expect(result.action).toEqual({ type: 'done', summary: 'ok' });
    });

    it('extracts first JSON from multiple fences', () => {
      const result = parseModelResponse(
        '```json\n{"action":{"type":"done","summary":"first"}}\n```\n```json\n{"action":{"type":"fail","reason":"second"}}\n```'
      );
      expect(result.action).toEqual({ type: 'done', summary: 'first' });
    });
  });

  describe('noise stripping', () => {
    it('strips trailing bridge ready noise', () => {
      const result = parseModelResponse('{"action":{"type":"done","summary":"ok"}}\n· Bridge ready');
      expect(result.action).toEqual({ type: 'done', summary: 'ok' });
    });

    it('strips starting agent loop noise', () => {
      const result = parseModelResponse('Starting agent loop...\n{"action":{"type":"done","summary":"ok"}}');
      expect(result.action).toEqual({ type: 'done', summary: 'ok' });
    });

    it('strips CDP browser bridge noise', () => {
      const result = parseModelResponse(
        '{"thought":"hi","action":{"type":"done","summary":"ok"}}\n· CDP browser bridge ready'
      );
      expect(result.action).toEqual({ type: 'done', summary: 'ok' });
    });
  });

  describe('alternative formats', () => {
    it('parses step.actions format', () => {
      const result = parseModelResponse('{"step":{"actions":[{"type":"click","x":10,"y":20}]}}');
      expect(result.action).toEqual({ type: 'click', x: 10, y: 20 });
    });

    it('parses actions array format', () => {
      const result = parseModelResponse('{"actions":[{"type":"navigate","url":"https://x.com"}]}');
      expect(result.action).toEqual({ type: 'navigate', url: 'https://x.com' });
    });

    it('parses flat type format', () => {
      const result = parseModelResponse('{"type":"done","summary":"done!"}');
      expect(result.action).toEqual({ type: 'done', summary: 'done!' });
    });
  });

  describe('error cases', () => {
    it('throws on empty string', () => {
      expect(() => parseModelResponse('')).toThrow('Could not parse');
    });

    it('throws on random text', () => {
      expect(() => parseModelResponse('hello world')).toThrow('Could not parse');
    });

    it('treats missing action as truncated response', () => {
      const result = parseModelResponse('{"thought":"hi"}');
      expect(result.action).toEqual({ type: 'wait', ms: 500 });
    });

    it('throws on unknown action type', () => {
      expect(() => parseModelResponse('{"action":{"type":"flyToTheMoon"}}')).toThrow('Could not parse');
    });
  });
});

describe('ParserState isolation', () => {
  it('does not leak truncation count between independent states', () => {
    const state1: ParserState = { consecutiveTruncations: 0 };
    const state2: ParserState = { consecutiveTruncations: 0 };

    // Simulate truncation on state1 (truncated response = thought with no action)
    parseModelResponse('{"thought": "thinking about something long..."}', state1);
    expect(state1.consecutiveTruncations).toBe(1);
    expect(state2.consecutiveTruncations).toBe(0);
  });

  it('resets truncation counter on successful parse', () => {
    const state: ParserState = { consecutiveTruncations: 2 };
    parseModelResponse('{"action":{"type":"done","summary":"ok"}}', state);
    expect(state.consecutiveTruncations).toBe(0);
  });

  it('fails after MAX_TRUNCATION_RETRIES on a given state', () => {
    const state: ParserState = { consecutiveTruncations: 0 };
    // First two truncations → wait action
    parseModelResponse('{"thought": "truncated..."}', state);
    parseModelResponse('{"thought": "truncated again..."}', state);
    expect(state.consecutiveTruncations).toBe(2);

    // Third truncation exceeds limit → fail action
    const result = parseModelResponse('{"thought": "still truncated..."}', state);
    expect(result.action.type).toBe('fail');
    expect(state.consecutiveTruncations).toBe(0); // reset after fail
  });

  it('two independent states do not interfere at max retries', () => {
    const state1: ParserState = { consecutiveTruncations: 0 };
    const state2: ParserState = { consecutiveTruncations: 0 };

    // Exhaust state1
    parseModelResponse('{"thought": "t"}', state1);
    parseModelResponse('{"thought": "t"}', state1);
    parseModelResponse('{"thought": "t"}', state1); // fail

    // state2 should still be at 0 and able to parse normally
    expect(state2.consecutiveTruncations).toBe(0);
    const result = parseModelResponse('{"action":{"type":"done","summary":"ok"}}', state2);
    expect(result.action.type).toBe('done');
  });
});

// ── On-chain trading action types ────────────────────────────────────────────
describe('parseModelResponse — on-chain trading actions', () => {
  it('parses chain_get_balance', () => {
    const { action } = parseModelResponse('{"action":{"type":"chain_get_balance"}}');
    expect(action.type).toBe('chain_get_balance');
  });

  it('parses chain_get_balance with chainId', () => {
    const { action } = parseModelResponse('{"action":{"type":"chain_get_balance","chainId":84532}}');
    expect(action.type).toBe('chain_get_balance');
    expect((action as any).chainId).toBe(84532);
  });

  it('parses chain_get_token_balance', () => {
    const { action } = parseModelResponse(
      '{"action":{"type":"chain_get_token_balance","tokenAddress":"0xusdc"}}'
    );
    expect(action.type).toBe('chain_get_token_balance');
    expect((action as any).tokenAddress).toBe('0xusdc');
  });

  it('parses chain_send_token', () => {
    const { action } = parseModelResponse(
      '{"thought":"Send USDC","action":{"type":"chain_send_token","tokenAddress":"0xusdc","to":"0xrecip","amount":"10.0"}}'
    );
    expect(action.type).toBe('chain_send_token');
    expect((action as any).amount).toBe('10.0');
  });

  it('parses chain_swap with slippageBps', () => {
    const { action } = parseModelResponse(
      '{"action":{"type":"chain_swap","tokenIn":"0xusdc","tokenOut":"0xweth","amountIn":"5.0","slippageBps":50}}'
    );
    expect(action.type).toBe('chain_swap');
    expect((action as any).slippageBps).toBe(50);
  });

  it('parses chain_get_tx_status', () => {
    const { action } = parseModelResponse(
      '{"action":{"type":"chain_get_tx_status","txHash":"0xdeadbeef"}}'
    );
    expect(action.type).toBe('chain_get_tx_status');
    expect((action as any).txHash).toBe('0xdeadbeef');
  });
});

// ── CEX trading action types ──────────────────────────────────────────────────
describe('parseModelResponse — CEX trading actions', () => {
  it('parses cex_get_balance for binance', () => {
    const { action } = parseModelResponse('{"action":{"type":"cex_get_balance","exchange":"binance"}}');
    expect(action.type).toBe('cex_get_balance');
    expect((action as any).exchange).toBe('binance');
  });

  it('parses cex_get_balance for coinbase', () => {
    const { action } = parseModelResponse('{"action":{"type":"cex_get_balance","exchange":"coinbase"}}');
    expect((action as any).exchange).toBe('coinbase');
  });

  it('parses cex_place_order market buy', () => {
    const { action } = parseModelResponse(
      '{"action":{"type":"cex_place_order","exchange":"binance","symbol":"BTCUSDT","side":"buy","orderType":"market","amount":50}}'
    );
    expect(action.type).toBe('cex_place_order');
    expect((action as any).symbol).toBe('BTCUSDT');
    expect((action as any).side).toBe('buy');
    expect((action as any).amount).toBe(50);
  });

  it('parses cex_place_order limit sell with price', () => {
    const { action } = parseModelResponse(
      '{"action":{"type":"cex_place_order","exchange":"coinbase","symbol":"BTC-USD","side":"sell","orderType":"limit","amount":0.001,"price":70000}}'
    );
    expect((action as any).price).toBe(70000);
    expect((action as any).orderType).toBe('limit');
  });

  it('parses cex_cancel_order', () => {
    const { action } = parseModelResponse(
      '{"action":{"type":"cex_cancel_order","exchange":"binance","orderId":"12345","symbol":"BTCUSDT"}}'
    );
    expect(action.type).toBe('cex_cancel_order');
    expect((action as any).orderId).toBe('12345');
  });

  it('parses cex_get_positions', () => {
    const { action } = parseModelResponse(
      '{"action":{"type":"cex_get_positions","exchange":"coinbase"}}'
    );
    expect(action.type).toBe('cex_get_positions');
  });

  it('parses cex_withdraw', () => {
    const { action } = parseModelResponse(
      '{"action":{"type":"cex_withdraw","exchange":"binance","asset":"USDT","amount":100,"address":"0xabc","network":"ETH"}}'
    );
    expect(action.type).toBe('cex_withdraw');
    expect((action as any).asset).toBe('USDT');
    expect((action as any).network).toBe('ETH');
  });
});

describe('orchestrator actions', () => {
  it('parses task_spawn action', () => {
    const raw = JSON.stringify({
      thought: 'spawning research agent',
      action: { type: 'task_spawn', prompt: 'Research BTC', mode: 'browser', agentRole: 'Research', agentName: 'Scout' }
    });
    const result = parseModelResponse(raw);
    expect(result.action.type).toBe('task_spawn');
    expect((result.action as any).prompt).toBe('Research BTC');
    expect((result.action as any).mode).toBe('browser');
    expect((result.action as any).agentRole).toBe('Research');
  });

  it('parses task_wait action with single taskId', () => {
    const raw = JSON.stringify({
      thought: 'waiting for research',
      action: { type: 'task_wait', taskIds: ['task_abc123'] }
    });
    const result = parseModelResponse(raw);
    expect(result.action.type).toBe('task_wait');
    expect((result.action as any).taskIds).toEqual(['task_abc123']);
  });

  it('parses task_wait action with multiple taskIds and timeout', () => {
    const raw = JSON.stringify({
      action: { type: 'task_wait', taskIds: ['task_a', 'task_b'], timeoutMs: 60000 }
    });
    const result = parseModelResponse(raw);
    expect(result.action.type).toBe('task_wait');
    expect((result.action as any).taskIds).toEqual(['task_a', 'task_b']);
    expect((result.action as any).timeoutMs).toBe(60000);
  });

  it('parses plan action with full OrchestratorPlan', () => {
    const plan = {
      objective: 'Research and summarize BTC news',
      constraints: ['Use public sources only'],
      subtasks: [{ id: 'r1', prompt: 'Find top 5 BTC news', role: 'Research' }],
      successCriteria: ['Summary with 3+ sources'],
      failureCriteria: ['No sources found'],
      risks: ['Sources may be outdated'],
    };
    const raw = JSON.stringify({
      thought: 'Creating plan',
      action: { type: 'plan', plan }
    });
    const result = parseModelResponse(raw);
    expect(result.action.type).toBe('plan');
    expect((result.action as any).plan.objective).toBe('Research and summarize BTC news');
    expect((result.action as any).plan.subtasks).toHaveLength(1);
    expect((result.action as any).plan.subtasks[0].role).toBe('Research');
  });
});

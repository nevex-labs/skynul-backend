import { describe, expect, it } from 'vitest';
import type { VisionMessage } from '../../types';
import {
  computeBudget,
  estimateImageTokens,
  estimatePayloadTokens,
  estimateTokens,
  getContextWindow,
} from './context-budget';

// ── getContextWindow ──────────────────────────────────────────────────────────

describe('getContextWindow', () => {
  it('returns exact match for known provider:model', () => {
    expect(getContextWindow('chatgpt', 'gpt-4.1')).toBe(1_047_576);
    expect(getContextWindow('claude', 'claude-sonnet-4-6')).toBe(200_000);
    expect(getContextWindow('deepseek', 'deepseek-chat')).toBe(64_000);
  });

  it('falls back to provider default when model is unknown', () => {
    expect(getContextWindow('chatgpt', 'some-future-model')).toBe(128_000);
    expect(getContextWindow('claude', 'claude-future')).toBe(200_000);
    expect(getContextWindow('ollama', 'llama4')).toBe(32_000);
  });

  it('falls back to provider default when model is undefined', () => {
    expect(getContextWindow('glm')).toBe(8_000);
    expect(getContextWindow('minimax')).toBe(204_800);
  });

  it('respects override regardless of provider or model', () => {
    expect(getContextWindow('chatgpt', 'gpt-4.1', 50_000)).toBe(50_000);
    expect(getContextWindow('ollama', undefined, 200_000)).toBe(200_000);
  });

  it('ignores override when it is 0 or negative', () => {
    expect(getContextWindow('chatgpt', 'gpt-4.1', 0)).toBe(1_047_576);
    expect(getContextWindow('chatgpt', 'gpt-4.1', -1)).toBe(1_047_576);
  });

  it('uses 128k fallback for completely unknown provider', () => {
    expect(getContextWindow('unknown-provider' as any)).toBe(128_000);
  });
});

// ── estimateTokens ────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1); // 4 chars → 1 token
    expect(estimateTokens('abcde')).toBe(2); // 5 chars → ceil(5/4)=2
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('handles unicode (counts char code units, not bytes)', () => {
    // 'hello' = 5 chars → 2 tokens
    expect(estimateTokens('hello')).toBe(2);
  });
});

// ── estimateImageTokens ───────────────────────────────────────────────────────

describe('estimateImageTokens', () => {
  it('returns 85 for low detail', () => {
    expect(estimateImageTokens('low')).toBe(85);
  });

  it('returns 800 for auto detail (conservative)', () => {
    expect(estimateImageTokens('auto')).toBe(800);
    expect(estimateImageTokens()).toBe(800); // default
  });

  it('returns 800 for high detail', () => {
    expect(estimateImageTokens('high')).toBe(800);
  });
});

// ── estimatePayloadTokens ─────────────────────────────────────────────────────

describe('estimatePayloadTokens', () => {
  it('counts system prompt tokens', () => {
    const tokens = estimatePayloadTokens('a'.repeat(400), []);
    expect(tokens).toBe(100); // 400 chars / 4
  });

  it('counts text content in messages', () => {
    const messages: VisionMessage[] = [{ role: 'user', content: [{ type: 'input_text', text: 'a'.repeat(400) }] }];
    expect(estimatePayloadTokens('', messages)).toBe(100);
  });

  it('counts output_text in assistant messages', () => {
    const messages: VisionMessage[] = [
      { role: 'assistant', content: [{ type: 'output_text', text: 'a'.repeat(400) }] },
    ];
    expect(estimatePayloadTokens('', messages)).toBe(100);
  });

  it('adds 800 tokens for each auto-detail image', () => {
    const messages: VisionMessage[] = [
      {
        role: 'user',
        content: [{ type: 'input_image', image_url: 'data:image/png;base64,...', detail: 'auto' }],
      },
    ];
    expect(estimatePayloadTokens('', messages)).toBe(800);
  });

  it('adds 85 tokens for low-detail image', () => {
    const messages: VisionMessage[] = [
      {
        role: 'user',
        content: [{ type: 'input_image', image_url: 'data:image/png;base64,...', detail: 'low' }],
      },
    ];
    expect(estimatePayloadTokens('', messages)).toBe(85);
  });

  it('accumulates system + all messages', () => {
    const messages: VisionMessage[] = [
      { role: 'user', content: [{ type: 'input_text', text: 'a'.repeat(400) }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'b'.repeat(400) }] },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'c'.repeat(400) },
          { type: 'input_image', image_url: 'data:...', detail: 'auto' },
        ],
      },
    ];
    // system: 0, msg1: 100, msg2: 100, msg3: 100+800 = 1100
    expect(estimatePayloadTokens('', messages)).toBe(1100);
  });
});

// ── computeBudget ─────────────────────────────────────────────────────────────

describe('computeBudget', () => {
  const sp = 'a'.repeat(40_000); // ~10_000 tokens

  it('uses estimation when no reported tokens', () => {
    const budget = computeBudget(sp, [], 'chatgpt', 'gpt-4.1');
    expect(budget.estimated).toBe(true);
    expect(budget.usedTokens).toBe(estimateTokens(sp));
    expect(budget.maxTokens).toBe(1_047_576);
  });

  it('uses reported tokens when provided (estimated=false)', () => {
    const budget = computeBudget('x', [], 'chatgpt', 'gpt-4.1', undefined, 50_000);
    expect(budget.estimated).toBe(false);
    expect(budget.usedTokens).toBe(50_000);
  });

  it('computes contextPct as usedTokens / maxTokens', () => {
    const budget = computeBudget('x', [], 'chatgpt', 'gpt-4.1', undefined, 64_000);
    expect(budget.contextPct).toBeCloseTo(64_000 / 1_047_576);
  });

  it('applyLevel1=false below 45%', () => {
    // Use reported tokens just under 45% of 128k context
    const max = 128_000;
    const used = Math.floor(max * 0.44);
    const budget = computeBudget('x', [], 'openrouter', undefined, undefined, used);
    expect(budget.applyLevel1).toBe(false);
    expect(budget.applyLevel2).toBe(false);
    expect(budget.applyLevel3).toBe(false);
  });

  it('applyLevel1=true above 45%', () => {
    const max = 128_000;
    const used = Math.ceil(max * 0.46);
    const budget = computeBudget('x', [], 'openrouter', undefined, undefined, used);
    expect(budget.applyLevel1).toBe(true);
    expect(budget.applyLevel2).toBe(false);
  });

  it('applyLevel2=true above 55%', () => {
    const max = 128_000;
    const used = Math.ceil(max * 0.56);
    const budget = computeBudget('x', [], 'openrouter', undefined, undefined, used);
    expect(budget.applyLevel1).toBe(true);
    expect(budget.applyLevel2).toBe(true);
    expect(budget.applyLevel3).toBe(false);
  });

  it('applyLevel3=true above 65%', () => {
    const max = 128_000;
    const used = Math.ceil(max * 0.66);
    const budget = computeBudget('x', [], 'openrouter', undefined, undefined, used);
    expect(budget.applyLevel1).toBe(true);
    expect(budget.applyLevel2).toBe(true);
    expect(budget.applyLevel3).toBe(true);
  });

  it('respects contextWindowOverride for threshold calculations', () => {
    // With a tiny override window, even small usage should trigger all levels
    const budget = computeBudget('x', [], 'chatgpt', 'gpt-4.1', 100, 90);
    expect(budget.maxTokens).toBe(100);
    expect(budget.contextPct).toBeCloseTo(0.9);
    expect(budget.applyLevel3).toBe(true);
  });
});

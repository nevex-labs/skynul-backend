import { describe, expect, it } from 'vitest';
import type { VisionMessage } from '../../../types';
import {
  DEFAULT_SNIP_CONFIG,
  type SnipConfig,
  calculateHistoryTokens,
  createReinjectionMessage,
  shouldSnip,
  snipHistory,
} from './snip-compaction';

// Helper to create test messages
function createMessages(count: number): VisionMessage[] {
  const messages: VisionMessage[] = [
    {
      role: 'user',
      content: [{ type: 'input_text', text: '[SYSTEM] System prompt'.repeat(10) }],
    },
  ];

  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: i % 2 === 0 ? 'input_text' : 'output_text', text: `Message ${i} content`.repeat(20) }],
    });
  }

  return messages;
}

describe('shouldSnip', () => {
  it('returns false when below threshold', () => {
    expect(shouldSnip(1000, 10000)).toBe(false);
    expect(shouldSnip(7000, 10000)).toBe(false); // 70% < 80%
  });

  it('returns true when above threshold', () => {
    expect(shouldSnip(8500, 10000)).toBe(true); // 85% > 80%
    expect(shouldSnip(9000, 10000)).toBe(true);
  });

  it('respects custom threshold', () => {
    expect(shouldSnip(5000, 10000, { thresholdPct: 0.4 })).toBe(true); // 50% > 40%
    expect(shouldSnip(3000, 10000, { thresholdPct: 0.4 })).toBe(false); // 30% < 40%
  });
});

describe('calculateHistoryTokens', () => {
  it('returns 0 for empty history', () => {
    expect(calculateHistoryTokens([])).toBe(0);
  });

  it('estimates tokens from text length', () => {
    const messages: VisionMessage[] = [{ role: 'user', content: [{ type: 'input_text', text: 'a'.repeat(400) }] }];
    expect(calculateHistoryTokens(messages)).toBe(100); // 400 chars / 4
  });

  it('counts images as 800 tokens', () => {
    const messages: VisionMessage[] = [
      {
        role: 'user',
        content: [{ type: 'input_image', image_url: 'data:image/png;base64,abc', detail: 'auto' }],
      },
    ];
    expect(calculateHistoryTokens(messages)).toBe(800);
  });

  it('sums multiple messages', () => {
    const messages: VisionMessage[] = [
      { role: 'user', content: [{ type: 'input_text', text: 'a'.repeat(400) }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'b'.repeat(400) }] },
    ];
    expect(calculateHistoryTokens(messages)).toBe(200); // 100 + 100
  });
});

describe('snipHistory', () => {
  it('does nothing when below threshold', () => {
    const messages = createMessages(10);
    const originalLength = messages.length;
    const tokens = calculateHistoryTokens(messages);

    const result = snipHistory(messages, tokens, 100000);

    expect(result.snipped).toBe(false);
    expect(messages.length).toBe(originalLength);
    expect(result.removedCount).toBe(0);
  });

  it('removes middle messages when above threshold', () => {
    const messages = createMessages(20);
    const originalLength = messages.length;
    const tokens = calculateHistoryTokens(messages);
    const maxTokens = Math.floor(tokens / 0.85); // Force ~85% usage

    const result = snipHistory(messages, tokens, maxTokens);

    expect(result.snipped).toBe(true);
    expect(result.removedCount).toBeGreaterThan(0);
    expect(messages.length).toBeLessThan(originalLength);
  });

  it('always preserves first message', () => {
    const messages = createMessages(20);
    const tokens = calculateHistoryTokens(messages);
    const maxTokens = Math.floor(tokens / 0.85);
    const firstContent = messages[0].content[0];

    snipHistory(messages, tokens, maxTokens);

    expect(messages[0].content[0]).toEqual(firstContent);
  });

  it('preserves recent N messages', () => {
    const messages = createMessages(20);
    const tokens = calculateHistoryTokens(messages);
    const maxTokens = Math.floor(tokens / 0.85);
    const config: Partial<SnipConfig> = { preserveRecent: 4 };

    const result = snipHistory(messages, tokens, maxTokens, config);

    if (result.snipped) {
      // Should have at least preserveRecent + 1 (first) messages
      expect(messages.length).toBeGreaterThanOrEqual(config.preserveRecent! + 1);
    }
  });

  it('preserves history summary if exists', () => {
    const messages: VisionMessage[] = [
      { role: 'user', content: [{ type: 'input_text', text: '[SYSTEM] System' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'Old message 1' }] },
      { role: 'user', content: [{ type: 'input_text', text: '[HISTORY SUMMARY] Summary here [/HISTORY SUMMARY]' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'Recent message' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'Response' }] },
    ];

    const tokens = calculateHistoryTokens(messages) * 2; // Force snipping
    const result = snipHistory(messages, tokens, tokens * 0.5);

    const hasSummary = messages.some((m) => m.content.some((c) => 'text' in c && c.text.includes('[HISTORY SUMMARY]')));
    expect(hasSummary).toBe(true);
  });

  it('collects file references from snipped messages', () => {
    const messages: VisionMessage[] = [
      { role: 'user', content: [{ type: 'input_text', text: '[SYSTEM] System prompt content here to add tokens' }] },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Check /path/to/file.ts for details about the implementation' }],
      },
      { role: 'assistant', content: [{ type: 'output_text', text: 'Working on src/utils/helpers.js to fix the bug' }] },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Another message with reference to test/data.json for testing' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'Response with more text to ensure we have enough tokens for snipping logic to work properly',
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Recent message 1 with some additional content to make sure' }],
      },
      { role: 'assistant', content: [{ type: 'output_text', text: 'Recent response 1' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'Recent message 2' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'Recent response 2' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'Recent message 3' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'Recent response 3' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'Recent message 4' }] },
    ];

    // Calculate actual tokens and set threshold high enough to trigger snipping
    const actualTokens = calculateHistoryTokens(messages);
    const maxTokens = Math.floor(actualTokens * 0.5); // Force snipping

    const result = snipHistory(messages, actualTokens, maxTokens);

    expect(result.snipped).toBe(true);
    expect(result.fileReferences.length).toBeGreaterThan(0);
    expect(result.fileReferences.some((ref) => ref.includes('file.ts') || ref.includes('helpers.js'))).toBe(true);
  });

  it('returns correct token counts', () => {
    const messages = createMessages(20);
    const tokens = calculateHistoryTokens(messages);
    const maxTokens = Math.floor(tokens / 0.85);

    const result = snipHistory(messages, tokens, maxTokens);

    expect(result.tokensBefore).toBe(tokens);
    if (result.snipped) {
      expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    } else {
      expect(result.tokensAfter).toBe(result.tokensBefore);
    }
  });

  it('does not snip if history too short', () => {
    const messages = createMessages(5);
    const tokens = calculateHistoryTokens(messages) * 10; // Would trigger but too short

    const result = snipHistory(messages, tokens, tokens * 0.05);

    expect(result.snipped).toBe(false);
    expect(result.reason).toContain('too short');
  });
});

describe('createReinjectionMessage', () => {
  it('returns undefined for empty refs', () => {
    expect(createReinjectionMessage([])).toBeUndefined();
  });

  it('creates message with file list', () => {
    const refs = ['/path/to/file.ts', 'src/utils/helpers.js'];
    const msg = createReinjectionMessage(refs);

    expect(msg).toBeDefined();
    expect(msg?.role).toBe('user');
    expect(msg?.content[0].type).toBe('input_text');
    expect((msg?.content[0] as { text: string }).text).toContain('file.ts');
    expect((msg?.content[0] as { text: string }).text).toContain('helpers.js');
  });

  it('limits to 10 refs', () => {
    const refs = Array.from({ length: 15 }, (_, i) => `file${i}.ts`);
    const msg = createReinjectionMessage(refs);

    const text = (msg?.content[0] as { text: string }).text;
    const matches = text.match(/file\d+\.ts/g);
    expect(matches?.length).toBeLessThanOrEqual(10);
  });
});

describe('DEFAULT_SNIP_CONFIG', () => {
  it('has correct defaults', () => {
    expect(DEFAULT_SNIP_CONFIG.thresholdPct).toBe(0.8);
    expect(DEFAULT_SNIP_CONFIG.targetPct).toBe(0.6);
    expect(DEFAULT_SNIP_CONFIG.preserveRecent).toBe(6);
    expect(DEFAULT_SNIP_CONFIG.maxTokens).toBe(200_000);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { headTail } from './action-executors';

describe('headTail', () => {
  it('returns text unchanged if under limit', () => {
    expect(headTail('short', 100)).toBe('short');
  });

  it('keeps head and tail when over limit', () => {
    const text = 'a'.repeat(200);
    const result = headTail(text, 100);
    expect(result).toContain('aaaaaa'); // head
    expect(result).toContain('[... 100 chars omitted ...]');
    expect(result).toContain('aaaaaa'); // tail
  });

  it('handles exactly limit length', () => {
    const text = 'x'.repeat(50);
    expect(headTail(text, 50)).toBe(text);
  });
});

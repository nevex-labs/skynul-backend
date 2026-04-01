import { describe, expect, it } from 'vitest';
import { budgetResult, exceedsBudget } from '../tool-result-budget';

describe('budgetResult', () => {
  it('returns result unchanged when under limit', () => {
    const result = budgetResult('short result', 'shell');
    expect(result).toBe('short result');
  });

  it('truncates shell results over 12000 chars', () => {
    const long = 'x'.repeat(15_000);
    const result = budgetResult(long, 'shell');
    expect(result.length).toBeLessThan(13_000);
    expect(result).toContain('truncated');
    expect(result).toContain('3000 chars');
  });

  it('truncates file_read results over 15000 chars', () => {
    const long = 'x'.repeat(20_000);
    const result = budgetResult(long, 'file_read');
    expect(result.length).toBeLessThan(16_000);
    expect(result).toContain('truncated');
  });

  it('uses default limit for unknown action types', () => {
    const long = 'x'.repeat(10_000);
    const result = budgetResult(long, 'some_new_action');
    expect(result.length).toBeLessThan(9_000);
    expect(result).toContain('truncated');
  });

  it('preserves head and tail of the result', () => {
    const head = 'START';
    const tail = 'END';
    const middle = 'x'.repeat(10_000);
    const original = head + middle + tail;
    const result = budgetResult(original, 'shell');

    expect(result.startsWith('START')).toBe(true);
    expect(result.endsWith('END')).toBe(true);
  });

  it('respects custom maxChars config', () => {
    const long = 'x'.repeat(200);
    const result = budgetResult(long, 'shell', { maxChars: 100 });
    // 100 chars of content + ~60 chars of truncation message
    expect(result.length).toBeLessThan(200);
    expect(result).toContain('truncated');
  });

  it('respects per-action-type config override', () => {
    const long = 'x'.repeat(200);
    const result = budgetResult(long, 'shell', { perActionLimits: { shell: 50 } });
    // 50 chars of content + truncation message
    expect(result.length).toBeLessThan(200);
    expect(result).toContain('truncated');
  });

  it('handles empty string', () => {
    expect(budgetResult('', 'shell')).toBe('');
  });

  it('handles exact limit', () => {
    const exact = 'x'.repeat(12_000);
    expect(budgetResult(exact, 'shell')).toBe(exact);
  });
});

describe('exceedsBudget', () => {
  it('returns false when under limit', () => {
    expect(exceedsBudget('short', 'shell')).toBe(false);
  });

  it('returns true when over limit', () => {
    expect(exceedsBudget('x'.repeat(15_000), 'shell')).toBe(true);
  });

  it('returns false at exact limit', () => {
    expect(exceedsBudget('x'.repeat(12_000), 'shell')).toBe(false);
  });

  it('returns true one char over limit', () => {
    expect(exceedsBudget('x'.repeat(12_001), 'shell')).toBe(true);
  });

  it('uses per-action limits', () => {
    expect(exceedsBudget('x'.repeat(13_000), 'file_read')).toBe(false);
    expect(exceedsBudget('x'.repeat(16_000), 'file_read')).toBe(true);
  });

  it('respects custom config', () => {
    expect(exceedsBudget('x'.repeat(50), 'shell', { maxChars: 100 })).toBe(false);
    expect(exceedsBudget('x'.repeat(150), 'shell', { maxChars: 100 })).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisionMessage } from '../../../types';
import {
  DEFAULT_AUTO_COMPACT_CONFIG,
  autoCompact,
  getCircuitBreakerState,
  getSummarizationModel,
  resetCircuitBreaker,
  shouldAutoCompact,
} from './auto-compact';

// Mock vision-dispatch
const mockCallVision = vi.fn();

vi.mock('../vision-dispatch', () => ({
  callVision: (...args: unknown[]) => mockCallVision(...args),
}));

describe('shouldAutoCompact', () => {
  beforeEach(() => {
    resetCircuitBreaker();
  });

  it('returns false when below threshold', () => {
    expect(shouldAutoCompact(1000, 10000)).toBe(false);
    expect(shouldAutoCompact(9000, 10000)).toBe(false);
  });

  it('returns true when above threshold', () => {
    expect(shouldAutoCompact(9600, 10000)).toBe(true);
  });
});

describe('getSummarizationModel', () => {
  it('returns correct model for chatgpt', () => {
    expect(getSummarizationModel('chatgpt')).toBe('gpt-4.1-nano');
  });

  it('returns correct model for claude', () => {
    expect(getSummarizationModel('claude')).toBe('claude-haiku-4-5-20251001');
  });

  it('returns correct model for gemini', () => {
    expect(getSummarizationModel('gemini')).toBe('gemini-2.0-flash');
  });

  it('returns default for unknown provider', () => {
    expect(getSummarizationModel('unknown' as any)).toBe('gpt-4.1-nano');
  });
});

describe('DEFAULT_AUTO_COMPACT_CONFIG', () => {
  it('has correct defaults', () => {
    expect(DEFAULT_AUTO_COMPACT_CONFIG.thresholdPct).toBe(0.95);
    expect(DEFAULT_AUTO_COMPACT_CONFIG.targetPct).toBe(0.5);
    expect(DEFAULT_AUTO_COMPACT_CONFIG.maxFailures).toBe(3);
    expect(DEFAULT_AUTO_COMPACT_CONFIG.preserveRecent).toBe(6);
    expect(DEFAULT_AUTO_COMPACT_CONFIG.timeoutMs).toBe(30000);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { VisionMessage } from '../../../shared/types';
import {
  DEFAULT_RECOVERY_CONFIG,
  attemptRecovery,
  formatRecoveryReport,
  isContextLengthError,
} from './reactive-recovery';

// Mock dependencies
vi.mock('./snip-compaction', () => ({
  snipHistory: vi.fn((history, usedTokens, maxTokens, config) => ({
    snipped: true,
    removedCount: 5,
    tokensBefore: usedTokens,
    tokensAfter: usedTokens * 0.6,
    reason: 'Snipped successfully',
  })),
  DEFAULT_SNIP_CONFIG: {
    thresholdPct: 0.8,
    targetPct: 0.6,
    preserveRecent: 6,
  },
}));

vi.mock('./auto-compact', () => ({
  autoCompact: vi.fn(),
  DEFAULT_AUTO_COMPACT_CONFIG: {
    thresholdPct: 0.95,
    targetPct: 0.5,
    maxFailures: 3,
    preserveRecent: 6,
    timeoutMs: 30000,
  },
  getSummarizationModel: vi.fn(() => 'gpt-4.1-nano'),
}));

describe('isContextLengthError', () => {
  it('detects 413 errors', () => {
    expect(isContextLengthError(new Error('Request failed with status 413'))).toBe(true);
    expect(isContextLengthError('413 Payload Too Large')).toBe(true);
  });

  it('detects context_length_exceeded', () => {
    expect(isContextLengthError(new Error('context_length_exceeded'))).toBe(true);
    expect(isContextLengthError({ code: 'context_length_exceeded' })).toBe(true);
  });

  it('detects max_tokens_exceeded', () => {
    expect(isContextLengthError(new Error('max_tokens_exceeded'))).toBe(true);
  });

  it('detects prompt_too_long', () => {
    expect(isContextLengthError(new Error('prompt_too_long'))).toBe(true);
  });

  it('detects token_limit_exceeded', () => {
    expect(isContextLengthError(new Error('token_limit_exceeded'))).toBe(true);
  });

  it('detects "too many tokens"', () => {
    expect(isContextLengthError(new Error('too many tokens'))).toBe(true);
  });

  it('detects "context window"', () => {
    expect(isContextLengthError(new Error('exceeds context window'))).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isContextLengthError(new Error('Network error'))).toBe(false);
    expect(isContextLengthError(new Error('Authentication failed'))).toBe(false);
    expect(isContextLengthError(null)).toBe(false);
  });
});

describe('DEFAULT_RECOVERY_CONFIG', () => {
  it('has correct defaults', () => {
    expect(DEFAULT_RECOVERY_CONFIG.maxAttempts).toBe(3);
    expect(DEFAULT_RECOVERY_CONFIG.tryModelFallback).toBe(true);
    expect(DEFAULT_RECOVERY_CONFIG.minTokensReduction).toBe(1000);
  });
});

describe('formatRecoveryReport', () => {
  it('formats successful attempts', () => {
    const result = {
      recovered: true,
      history: [],
      attempts: [
        {
          strategy: 'snip' as const,
          success: true,
          details: 'Removed 5 messages',
          tokensBefore: 10000,
          tokensAfter: 6000,
        },
      ],
    };

    const report = formatRecoveryReport(result);
    expect(report).toContain('Context Length Recovery Attempted');
    expect(report).toContain('✓ snip:');
    expect(report).toContain('10000 → 6000');
  });

  it('formats failed attempts', () => {
    const result = {
      recovered: false,
      history: [],
      attempts: [
        { strategy: 'snip' as const, success: false, details: 'Nothing to snip' },
        { strategy: 'compact' as const, success: false, details: 'API timeout' },
      ],
      error: 'All recovery attempts failed',
    };

    const report = formatRecoveryReport(result);
    expect(report).toContain('✗ snip:');
    expect(report).toContain('✗ compact:');
    expect(report).toContain('All recovery attempts failed');
  });

  it('includes fallback model when available', () => {
    const result = {
      recovered: true,
      history: [],
      fallbackModel: 'gpt-4.1-nano',
      attempts: [{ strategy: 'fallback' as const, success: true, details: 'Switched to gpt-4.1-nano' }],
    };

    const report = formatRecoveryReport(result);
    expect(report).toContain('Fallback model suggested: gpt-4.1-nano');
  });
});

import * as fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisionMessage } from '../../../types';
import {
  ACTION_LIMITS,
  DEFAULT_MAX_RESULT_CHARS,
  DEFAULT_TOOL_BUDGET_CONFIG,
  applyBudget,
  cleanupPersistedResults,
  exceedsBudget,
  persistResult,
  resolveLimit,
} from './tool-result-budget';

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe('resolveLimit', () => {
  it('returns default for unknown action', () => {
    expect(resolveLimit('unknown_action')).toBe(DEFAULT_MAX_RESULT_CHARS);
  });

  it('returns action-specific limit', () => {
    expect(resolveLimit('shell')).toBe(ACTION_LIMITS.shell);
    expect(resolveLimit('file_read')).toBe(ACTION_LIMITS.file_read);
  });

  it('respects config override', () => {
    const config = { maxChars: 5000 };
    expect(resolveLimit('unknown', config)).toBe(5000);
  });

  it('respects per-action override', () => {
    const config = { perActionLimits: { custom: 3000 } };
    expect(resolveLimit('custom', config)).toBe(3000);
  });

  it('prioritizes per-action over default', () => {
    const config = { maxChars: 5000, perActionLimits: { shell: 2000 } };
    expect(resolveLimit('shell', config)).toBe(2000);
  });
});

describe('exceedsBudget', () => {
  it('returns false when within budget', () => {
    expect(exceedsBudget('short', 'unknown')).toBe(false);
    expect(exceedsBudget('a'.repeat(8000), 'unknown')).toBe(false);
  });

  it('returns true when exceeding budget', () => {
    expect(exceedsBudget('a'.repeat(9000), 'unknown')).toBe(true);
  });

  it('respects action-specific limits', () => {
    expect(exceedsBudget('a'.repeat(13000), 'shell')).toBe(true);
    expect(exceedsBudget('a'.repeat(11000), 'shell')).toBe(false);
  });
});

describe('DEFAULT_TOOL_BUDGET_CONFIG', () => {
  it('has correct defaults', () => {
    expect(DEFAULT_TOOL_BUDGET_CONFIG.maxChars).toBe(DEFAULT_MAX_RESULT_CHARS);
    expect(DEFAULT_TOOL_BUDGET_CONFIG.persistDir).toBe('.skynul/results');
    expect(DEFAULT_TOOL_BUDGET_CONFIG.enablePersistence).toBe(true);
    expect(DEFAULT_TOOL_BUDGET_CONFIG.previewChars).toBe(2000);
  });
});

describe('applyBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it('returns unchanged when within budget', () => {
    const result = applyBudget('short result', 'unknown', 'task-1', 0);

    expect(result.result).toBe('short result');
    expect(result.persisted).toBe(false);
    expect(result.originalLength).toBe(12);
    expect(result.finalLength).toBe(12);
  });

  it('persists and returns preview when exceeding budget', () => {
    const longResult = 'a'.repeat(10000);

    const result = applyBudget(longResult, 'unknown', 'task-1', 0);

    expect(result.persisted).toBe(true);
    expect(result.filepath).toBeDefined();
    expect(result.result).toContain('[...');
    expect(result.result).toContain('chars omitted');
    expect(result.result).toContain('persisted to:');
    expect(result.originalLength).toBe(10000);
    expect(result.finalLength).toBeLessThan(10000);
  });

  it('truncates without persistence when persistence disabled', () => {
    const longResult = 'a'.repeat(10000);
    const config = { enablePersistence: false };

    const result = applyBudget(longResult, 'unknown', 'task-1', 0, config);

    expect(result.persisted).toBe(false);
    expect(result.result).toContain('[...');
    expect(result.result).toContain('truncated');
  });
});

describe('cleanupPersistedResults', () => {
  it('finds file references in messages', () => {
    const messages: VisionMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Result persisted to: .skynul/results/task_1_step0_shell_12345.txt',
          },
        ],
      },
    ];

    const result = cleanupPersistedResults(messages);

    expect(result.found).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('returns empty when no references', () => {
    const messages: VisionMessage[] = [
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Normal message without file refs' }],
      },
    ];

    const result = cleanupPersistedResults(messages);

    expect(result.found).toBe(0);
  });
});

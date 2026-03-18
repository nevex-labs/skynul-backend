import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadPolicy } from './policy-store';

const mockReadFile = vi.hoisted(() => vi.fn());

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('../config', () => ({
  getDataDir: () => '/tmp/skynul-test',
}));

describe('loadPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns DEFAULT_POLICY when file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const result = await loadPolicy();
    expect(result.provider.active).toBe('chatgpt');
    expect(result.taskMemoryEnabled).toBe(true);
  });

  it('returns DEFAULT_POLICY on parse error', async () => {
    mockReadFile.mockResolvedValue('not valid json{{');
    const result = await loadPolicy();
    expect(result.provider.active).toBe('chatgpt');
  });

  it('migrates openai provider to chatgpt', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        provider: { active: 'openai' },
      }),
    );
    const result = await loadPolicy();
    expect(result.provider.active).toBe('chatgpt');
  });

  it('preserves valid provider', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        provider: { active: 'claude' },
      }),
    );
    const result = await loadPolicy();
    expect(result.provider.active).toBe('claude');
  });

  it('merges partial config with defaults', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        themeMode: 'light',
        provider: { active: 'deepseek', openaiModel: 'deepseek-chat' },
      }),
    );
    const result = await loadPolicy();
    expect(result.themeMode).toBe('light');
    expect(result.provider.active).toBe('deepseek');
    expect(result.provider.openaiModel).toBe('deepseek-chat');
    expect(result.taskMemoryEnabled).toBe(true); // default
  });

  it('uses default model when not specified', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        provider: { active: 'chatgpt' },
      }),
    );
    const result = await loadPolicy();
    expect(result.provider.openaiModel).toBe('gpt-4.1-mini');
  });
});

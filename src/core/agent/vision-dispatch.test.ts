import { describe, expect, it, vi } from 'vitest';
import type { VisionMessage } from '../../types';
import { callVision } from './vision-dispatch';

function makeMsg(role: 'user' | 'assistant', text: string): VisionMessage {
  return { role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] };
}

const SYSTEM = 'system prompt';
const MESSAGES: VisionMessage[] = [makeMsg('user', 'hello')];

vi.mock('../providers/codex-vision', () => ({
  codexVisionRespond: vi.fn(() => Promise.resolve('chatgpt-response')),
}));

vi.mock('../providers/claude-vision', () => ({
  claudeVisionRespond: vi.fn(() => Promise.resolve({ text: 'claude-response' })),
}));

vi.mock('../providers/deepseek-vision', () => ({
  deepseekVisionRespond: vi.fn(() => Promise.resolve({ text: 'deepseek-response' })),
}));

vi.mock('../providers/kimi-vision', () => ({
  kimiVisionRespond: vi.fn(() => Promise.resolve({ text: 'kimi-text' })),
}));

vi.mock('../providers/glm-vision', () => ({
  glmVisionRespond: vi.fn(() => Promise.resolve({ text: 'glm-text' })),
}));

vi.mock('../providers/minimax-vision', () => ({
  minimaxVisionRespond: vi.fn(() => Promise.resolve({ text: 'minimax-text' })),
}));

vi.mock('../providers/openrouter-vision', () => ({
  openrouterVisionRespond: vi.fn(() => Promise.resolve({ text: 'or-text' })),
}));

vi.mock('../providers/gemini-vision', () => ({
  geminiVisionRespond: vi.fn(() => Promise.resolve({ text: 'gemini-text' })),
}));

vi.mock('../providers/ollama-vision', () => ({
  ollamaVisionRespond: vi.fn(() => Promise.resolve({ text: 'ollama-text' })),
}));

describe('callVision', () => {
  it('throws on unknown provider', async () => {
    await expect(callVision('unknown' as any, SYSTEM, MESSAGES)).rejects.toThrow('Unsupported provider: unknown');
  });

  it('dispatches to chatgpt and normalizes string to { text }', async () => {
    const result = await callVision('chatgpt', SYSTEM, MESSAGES, 'session-1', 'gpt-4o');
    expect(result).toEqual({ text: 'chatgpt-response' });
  });

  it('dispatches to claude and normalizes string response', async () => {
    const result = await callVision('claude', SYSTEM, MESSAGES);
    expect(result).toEqual({ text: 'claude-response' });
  });

  it('dispatches to deepseek and normalizes string response', async () => {
    const result = await callVision('deepseek', SYSTEM, MESSAGES);
    expect(result).toEqual({ text: 'deepseek-response' });
  });

  it('dispatches kimi and returns { text, usage } from provider', async () => {
    const result = await callVision('kimi', SYSTEM, MESSAGES);
    expect(result.text).toBe('kimi-text');
  });

  it('dispatches glm correctly', async () => {
    const result = await callVision('glm', SYSTEM, MESSAGES);
    expect(result.text).toBe('glm-text');
  });

  it('dispatches minimax correctly', async () => {
    const result = await callVision('minimax', SYSTEM, MESSAGES);
    expect(result.text).toBe('minimax-text');
  });

  it('dispatches openrouter correctly', async () => {
    const result = await callVision('openrouter', SYSTEM, MESSAGES);
    expect(result.text).toBe('or-text');
  });

  it('dispatches gemini correctly', async () => {
    const result = await callVision('gemini', SYSTEM, MESSAGES);
    expect(result.text).toBe('gemini-text');
  });

  it('dispatches ollama correctly', async () => {
    const result = await callVision('ollama', SYSTEM, MESSAGES);
    expect(result.text).toBe('ollama-text');
  });
});

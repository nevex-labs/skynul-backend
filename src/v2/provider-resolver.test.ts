import { describe, expect, it } from 'vitest';
import {
  PROVIDER_PRIORITY,
  PROVIDER_SECRET_KEYS,
  type SecretReader,
  isConfigured,
  listConfigured,
  resolveProvider,
} from './provider-resolver';

describe('provider-resolver', () => {
  // Test helper: create a mock secret reader
  function mockReader(secrets: Record<string, string>): SecretReader {
    return async (key: string) => secrets[key] ?? null;
  }

  describe('PROVIDER_SECRET_KEYS', () => {
    it('maps each provider to its secret key name', () => {
      expect(PROVIDER_SECRET_KEYS.gemini).toBe('gemini.apiKey');
      expect(PROVIDER_SECRET_KEYS.claude).toBe('claude.apiKey');
      expect(PROVIDER_SECRET_KEYS.chatgpt).toBe('openai.apiKey');
      expect(PROVIDER_SECRET_KEYS.ollama).toBe(null);
    });

    it('covers all providers', () => {
      const providers = Object.keys(PROVIDER_SECRET_KEYS);
      expect(providers).toContain('gemini');
      expect(providers).toContain('claude');
      expect(providers).toContain('ollama');
      expect(providers.length).toBe(9);
    });
  });

  describe('isConfigured', () => {
    it('returns true for ollama (no key needed)', async () => {
      const reader = mockReader({});
      const result = await isConfigured('ollama', reader);
      expect(result).toBe(true);
    });

    it('returns true when secret exists', async () => {
      const reader = mockReader({ 'gemini.apiKey': 'sk-123' });
      const result = await isConfigured('gemini', reader);
      expect(result).toBe(true);
    });

    it('returns false when secret is missing', async () => {
      const reader = mockReader({});
      const result = await isConfigured('gemini', reader);
      expect(result).toBe(false);
    });

    it('returns false when secret is empty string', async () => {
      const reader = mockReader({ 'gemini.apiKey': '' });
      const result = await isConfigured('gemini', reader);
      expect(result).toBe(false);
    });

    it('passes userId to the secret reader', async () => {
      let capturedUserId: number | undefined;
      const reader: SecretReader = async (_key, userId) => {
        capturedUserId = userId;
        return null;
      };
      await isConfigured('gemini', reader, 42);
      expect(capturedUserId).toBe(42);
    });
  });

  describe('resolveProvider', () => {
    it('returns first provider with a key', async () => {
      const reader = mockReader({ 'claude.apiKey': 'sk-ant-123' });
      const result = await resolveProvider(reader);
      expect(result).toBe('claude');
    });

    it('skips providers without keys', async () => {
      const reader = mockReader({ 'deepseek.apiKey': 'sk-ds-123' });
      const result = await resolveProvider(reader);
      expect(result).toBe('deepseek');
    });

    it('returns ollama if no keys exist', async () => {
      const reader = mockReader({});
      const result = await resolveProvider(reader);
      expect(result).toBe('ollama');
    });

    it('throws if no provider is configured (including ollama check)', async () => {
      // This test verifies the error path — in practice ollama is always available
      // so this would only happen if ollama is removed from the priority list
      const reader = mockReader({});
      // Remove ollama temporarily to test the error path
      const original = [...PROVIDER_PRIORITY];
      PROVIDER_PRIORITY.length = 0;
      PROVIDER_PRIORITY.push('gemini' as any, 'claude' as any);

      await expect(resolveProvider(reader)).rejects.toThrow('No LLM provider configured');

      // Restore
      PROVIDER_PRIORITY.length = 0;
      original.forEach((p) => PROVIDER_PRIORITY.push(p));
    });

    it('respects priority order when multiple keys exist', async () => {
      const reader = mockReader({
        'gemini.apiKey': 'sk-gem-123',
        'claude.apiKey': 'sk-ant-123',
        'openai.apiKey': 'sk-openai-123',
      });
      const result = await resolveProvider(reader);
      expect(result).toBe('gemini'); // gemini is first in priority
    });

    it('passes userId to secret reader', async () => {
      let capturedUserId: number | undefined;
      const reader: SecretReader = async (_key, userId) => {
        capturedUserId = userId;
        return userId === 5 ? 'sk-123' : null;
      };
      const result = await resolveProvider(reader, 5);
      expect(result).toBe('gemini');
      expect(capturedUserId).toBe(5);
    });
  });

  describe('listConfigured', () => {
    it('returns all configured providers in priority order', async () => {
      const reader = mockReader({
        'gemini.apiKey': 'sk-gem-123',
        'claude.apiKey': 'sk-ant-123',
      });
      const result = await listConfigured(reader);
      expect(result).toEqual(['gemini', 'claude', 'ollama']);
    });

    it('returns only ollama when no keys exist', async () => {
      const reader = mockReader({});
      const result = await listConfigured(reader);
      expect(result).toEqual(['ollama']);
    });

    it('returns empty array if ollama is not in priority', async () => {
      const reader = mockReader({});
      // Temporarily remove ollama
      const idx = PROVIDER_PRIORITY.indexOf('ollama');
      PROVIDER_PRIORITY.splice(idx, 1);

      const result = await listConfigured(reader);
      expect(result).toEqual([]);

      // Restore
      PROVIDER_PRIORITY.push('ollama');
    });
  });
});

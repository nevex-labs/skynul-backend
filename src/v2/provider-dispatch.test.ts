import { describe, expect, it, vi } from 'vitest';
import { type ChatMessage, PROVIDER_CONFIGS, type SecretReader, dispatchChat } from './provider-dispatch';

const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

function mockReader(secrets: Record<string, string>): SecretReader {
  return async (key: string) => secrets[key] ?? null;
}

function mockFetch(response: { status?: number; body: unknown }) {
  return vi.fn().mockResolvedValue({
    ok: response.status ? response.status < 400 : true,
    status: response.status ?? 200,
    statusText: response.status ? 'Error' : 'OK',
    text: async () => JSON.stringify(response.body),
    json: async () => response.body,
  });
}

describe('provider-dispatch', () => {
  describe('PROVIDER_CONFIGS', () => {
    it('has config for all providers', () => {
      const providers = Object.keys(PROVIDER_CONFIGS);
      expect(providers).toContain('gemini');
      expect(providers).toContain('claude');
      expect(providers).toContain('chatgpt');
      expect(providers).toContain('ollama');
      expect(providers.length).toBe(9);
    });

    it('each config has all required fields', () => {
      for (const [id, config] of Object.entries(PROVIDER_CONFIGS)) {
        expect(config).toHaveProperty('name');
        expect(config).toHaveProperty('url');
        expect(config).toHaveProperty('headers');
        expect(config).toHaveProperty('buildBody');
        expect(config).toHaveProperty('extractContent');
        expect(typeof config.name).toBe('string');
        expect(typeof config.url).toBe('function');
      }
    });
  });

  describe('dispatchChat', () => {
    it('throws for unknown provider', async () => {
      await expect(dispatchChat('not-a-provider' as any, messages, mockReader({}))).rejects.toThrow('Unknown provider');
    });

    it('throws when API key is missing', async () => {
      await expect(dispatchChat('gemini', messages, mockReader({}))).rejects.toThrow(
        'Gemini API key is not configured'
      );
    });

    it('does not require API key for ollama', async () => {
      const fetch = mockFetch({
        body: { message: { content: 'hi from ollama' } },
      });

      const result = await dispatchChat('ollama', messages, mockReader({}), undefined, fetch);
      expect(result).toBe('hi from ollama');
    });

    it('calls the correct URL with the API key', async () => {
      const fetch = mockFetch({
        body: { candidates: [{ content: { parts: [{ text: 'hello back' }] } }] },
      });

      await dispatchChat('gemini', messages, mockReader({ 'gemini.apiKey': 'sk-123' }), undefined, fetch);

      const callArgs = fetch.mock.calls[0];
      expect(callArgs[0]).toContain('generativelanguage.googleapis.com');
      expect(callArgs[0]).toContain('key=sk-123');
    });

    it('includes messages in the request body', async () => {
      const fetch = mockFetch({
        body: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
      });

      await dispatchChat('gemini', messages, mockReader({ 'gemini.apiKey': 'sk-123' }), undefined, fetch);

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].parts[0].text).toBe('hello');
    });

    it('throws on API error', async () => {
      const fetch = mockFetch({
        status: 429,
        body: { error: { message: 'Rate limited' } },
      });

      await expect(
        dispatchChat('gemini', messages, mockReader({ 'gemini.apiKey': 'sk-123' }), undefined, fetch)
      ).rejects.toThrow('Gemini error 429');
    });

    it('throws on empty response', async () => {
      const fetch = mockFetch({
        body: { candidates: [{ content: { parts: [{ text: '' }] } }] },
      });

      await expect(
        dispatchChat('gemini', messages, mockReader({ 'gemini.apiKey': 'sk-123' }), undefined, fetch)
      ).rejects.toThrow('Gemini returned an empty response');
    });

    it('passes userId to secret reader', async () => {
      let capturedUserId: number | undefined;
      const reader: SecretReader = async (key, userId) => {
        capturedUserId = userId;
        return key === 'gemini.apiKey' ? 'sk-123' : null;
      };
      const fetch = mockFetch({
        body: { candidates: [{ content: { parts: [{ text: 'hi' }] } }] },
      });

      await dispatchChat('gemini', messages, reader, 42, fetch);
      expect(capturedUserId).toBe(42);
    });

    it('handles Claude format correctly', async () => {
      const fetch = mockFetch({
        body: { content: [{ type: 'text', text: 'claude says hi' }] },
      });

      const result = await dispatchChat(
        'claude',
        messages,
        mockReader({ 'claude.apiKey': 'sk-ant-123' }),
        undefined,
        fetch
      );
      expect(result).toBe('claude says hi');
    });

    it('handles OpenAI format correctly', async () => {
      const fetch = mockFetch({
        body: { choices: [{ message: { content: 'gpt says hi' } }] },
      });

      const result = await dispatchChat(
        'chatgpt',
        messages,
        mockReader({ 'openai.apiKey': 'sk-openai-123' }),
        undefined,
        fetch
      );
      expect(result).toBe('gpt says hi');
    });

    it('handles system messages for Claude', async () => {
      const fetch = mockFetch({
        body: { content: [{ type: 'text', text: 'ok' }] },
      });

      const msgs: ChatMessage[] = [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'hello' },
      ];

      await dispatchChat('claude', msgs, mockReader({ 'claude.apiKey': 'sk-ant-123' }), undefined, fetch);

      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.system).toBe('you are helpful');
      expect(body.messages).toHaveLength(1);
    });
  });
});

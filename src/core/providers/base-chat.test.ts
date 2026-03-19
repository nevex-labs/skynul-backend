import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../types';
import { createChatProvider } from './base-chat';

const makeMessages = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({ role: 'user' as const, content: `msg-${i}` }));

describe('createChatProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns content from successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ choices: [{ message: { content: 'hello' } }] }),
        })
      )
    );

    const provider = createChatProvider({
      name: 'Test',
      url: 'https://example.com/chat',
      model: 'test-model',
      headers: (key) => ({ Authorization: `Bearer ${key}` }),
      buildBody: (messages, model, maxTokens) => ({ messages, model, max_tokens: maxTokens }),
      extractContent: (data) =>
        (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
    });

    const result = await provider({ dynamic: 'secret-key', messages: [{ role: 'user', content: 'hi' }] });
    expect(result).toBe('hello');
  });

  it('truncates messages to last N (default 20)', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createChatProvider({
      name: 'Test',
      url: 'https://example.com/chat',
      headers: () => ({}),
      buildBody: (messages) => ({ messages }),
      extractContent: () => 'ok',
    });

    const msgs = makeMessages(30);
    await provider({ dynamic: 'key', messages: msgs });

    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body as string);
    expect(body.messages).toHaveLength(20);
    expect(body.messages[0].content).toBe('msg-10');
    expect(body.messages[19].content).toBe('msg-29');
  });

  it('respects custom truncateMessages', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createChatProvider({
      name: 'Test',
      url: 'https://example.com/chat',
      truncateMessages: 5,
      headers: () => ({}),
      buildBody: (messages) => ({ messages }),
      extractContent: () => 'ok',
    });

    await provider({ dynamic: 'key', messages: makeMessages(10) });
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body as string);
    expect(body.messages).toHaveLength(5);
  });

  it('calls headers with dynamic value', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createChatProvider({
      name: 'Test',
      url: 'https://example.com/chat',
      headers: (dynamic) => ({ 'X-Dynamic': dynamic }),
      buildBody: () => ({}),
      extractContent: () => 'ok',
    });

    await provider({ dynamic: 'my-secret', messages: [] });
    expect((fetchMock.mock.calls[0] as any)[1].headers).toEqual({ 'X-Dynamic': 'my-secret' });
  });

  it('supports url as a function', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createChatProvider({
      name: 'Test',
      url: (dynamic) => `https://${dynamic}.example.com/chat`,
      headers: () => ({}),
      buildBody: () => ({}),
      extractContent: () => 'ok',
    });

    await provider({ dynamic: 'custom-host', messages: [] });
    expect((fetchMock.mock.calls[0] as any)[0]).toBe('https://custom-host.example.com/chat');
  });

  it('throws on empty response content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ choices: [{ message: { content: '' } }] }),
        })
      )
    );

    const provider = createChatProvider({
      name: 'Test',
      url: 'https://example.com/chat',
      headers: () => ({}),
      buildBody: () => ({}),
      extractContent: (data) =>
        (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
    });

    await expect(provider({ dynamic: 'key', messages: [] })).rejects.toThrow('Test returned an empty response');
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('invalid key'),
        })
      )
    );

    const provider = createChatProvider({
      name: 'TestProvider',
      url: 'https://example.com/chat',
      headers: () => ({}),
      buildBody: () => ({}),
      extractContent: () => 'content',
    });

    await expect(provider({ dynamic: 'key', messages: [] })).rejects.toThrow('TestProvider error 401: invalid key');
  });

  it('works without headers (no-auth provider)', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: { content: 'local-ai' } }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createChatProvider({
      name: 'LocalAI',
      url: 'http://localhost:11434/api/chat',
      model: 'qwen3.5:27b',
      headers: undefined,
      buildBody: (messages, model) => ({ model, messages, format: 'json' }),
      extractContent: (data) => (data as { message?: { content?: string } }).message?.content ?? '',
    });

    const result = await provider({ dynamic: '', messages: [{ role: 'user', content: 'hi' }] });
    expect(result).toBe('local-ai');
    expect((fetchMock.mock.calls[0] as any)[1].headers).toEqual({});
  });

  it('uses modelOverride when provided', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createChatProvider({
      name: 'Test',
      url: 'https://example.com/chat',
      model: 'default-model',
      headers: () => ({}),
      buildBody: (_messages, model) => ({ model }),
      extractContent: () => 'ok',
    });

    await provider({ dynamic: 'key', model: 'override-model', messages: [] });
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body as string);
    expect(body.model).toBe('override-model');
  });

  it('uses config model when no override', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createChatProvider({
      name: 'Test',
      url: 'https://example.com/chat',
      model: 'config-model',
      headers: () => ({}),
      buildBody: (_messages, model) => ({ model }),
      extractContent: () => 'ok',
    });

    await provider({ dynamic: 'key', messages: [] });
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body as string);
    expect(body.model).toBe('config-model');
  });
});

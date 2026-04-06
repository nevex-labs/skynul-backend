/**
 * Layer 2: Provider Dispatch
 *
 * Single entry point for all LLM interactions.
 * Takes a ProviderId, reads the API key via an injected SecretReader,
 * calls the correct provider implementation, and returns the raw text response.
 *
 * Self-contained — no dependencies on legacy code.
 */

import type { ProviderId } from './provider-resolver';

export type { ProviderId } from './provider-resolver';

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type SecretReader = (key: string, userId?: number) => Promise<string | null>;

export type HttpFetch = typeof fetch;

/**
 * Configuration for a single LLM provider.
 * Each provider is pure config — no inline fetch logic.
 */
export type ProviderConfig = {
  name: string;
  url: (apiKey: string) => string;
  headers: (apiKey: string) => Record<string, string>;
  buildBody: (messages: ChatMessage[], maxTokens: number) => Record<string, unknown>;
  extractContent: (data: unknown) => string;
  defaultMaxTokens?: number;
};

/**
 * Provider registry — maps ProviderId to its configuration.
 */
export const PROVIDER_CONFIGS: Record<ProviderId, ProviderConfig> = {
  gemini: {
    name: 'Gemini',
    url: (apiKey) =>
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    headers: () => ({ 'Content-Type': 'application/json' }),
    buildBody: (messages, maxTokens) => ({
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    extractContent: (data) =>
      (
        data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      ).candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('') ?? '',
    defaultMaxTokens: 4096,
  },

  claude: {
    name: 'Claude',
    url: () => 'https://api.anthropic.com/v1/messages',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
    buildBody: (messages, maxTokens) => {
      const systemMsg = messages.find((m) => m.role === 'system');
      const nonSystem = messages.filter((m) => m.role !== 'system');
      return {
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemMsg?.content,
        messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
      };
    },
    extractContent: (data) =>
      (data as { content?: Array<{ type?: string; text?: string }> }).content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('') ?? '',
    defaultMaxTokens: 4096,
  },

  chatgpt: {
    name: 'OpenAI',
    url: () => 'https://api.openai.com/v1/chat/completions',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }),
    buildBody: (messages, maxTokens) => ({
      model: 'gpt-4.1-mini',
      max_tokens: maxTokens,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
    extractContent: (data) =>
      (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
    defaultMaxTokens: 4096,
  },

  deepseek: {
    name: 'DeepSeek',
    url: () => 'https://api.deepseek.com/v1/chat/completions',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }),
    buildBody: (messages, maxTokens) => ({
      model: 'deepseek-chat',
      max_tokens: maxTokens,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
    extractContent: (data) =>
      (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
    defaultMaxTokens: 4096,
  },

  openrouter: {
    name: 'OpenRouter',
    url: () => 'https://openrouter.ai/api/v1/chat/completions',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }),
    buildBody: (messages, maxTokens) => ({
      model: 'anthropic/claude-sonnet-4',
      max_tokens: maxTokens,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
    extractContent: (data) =>
      (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
    defaultMaxTokens: 4096,
  },

  kimi: {
    name: 'Kimi',
    url: () => 'https://api.moonshot.cn/v1/chat/completions',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }),
    buildBody: (messages, maxTokens) => ({
      model: 'moonshot-v1-8k',
      max_tokens: maxTokens,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
    extractContent: (data) =>
      (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
    defaultMaxTokens: 4096,
  },

  glm: {
    name: 'GLM',
    url: () => 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }),
    buildBody: (messages, maxTokens) => ({
      model: 'glm-4',
      max_tokens: maxTokens,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
    extractContent: (data) =>
      (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
    defaultMaxTokens: 4096,
  },

  minimax: {
    name: 'MiniMax',
    url: () => 'https://api.minimax.chat/v1/text/chatcompletion_v2',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }),
    buildBody: (messages, maxTokens) => ({
      model: 'MiniMax-M1',
      max_tokens: maxTokens,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
    extractContent: (data) =>
      (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
    defaultMaxTokens: 4096,
  },

  ollama: {
    name: 'Ollama',
    url: () => 'http://localhost:11434/api/chat',
    headers: () => ({ 'Content-Type': 'application/json' }),
    buildBody: (messages, maxTokens) => ({
      model: 'llama3',
      stream: false,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      options: { num_predict: maxTokens },
    }),
    extractContent: (data) => (data as { message?: { content?: string } })?.message?.content ?? '',
    defaultMaxTokens: 4096,
  },
};

/**
 * Dispatch a chat conversation to an LLM provider.
 *
 * @param provider - The LLM provider to use.
 * @param messages - Array of chat messages.
 * @param readSecret - Function to read secrets from storage.
 * @param userId - Optional user ID for user-specific secrets.
 * @param httpFetch - Fetch implementation (defaults to global fetch).
 * @returns string - The raw text response from the LLM.
 * @throws Error - If the provider is not configured or the API call fails.
 */
export async function dispatchChat(
  provider: ProviderId,
  messages: ChatMessage[],
  readSecret: SecretReader,
  userId?: number,
  httpFetch: HttpFetch = fetch
): Promise<string> {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  // Ollama doesn't need an API key
  const needsKey = provider !== 'ollama';

  let apiKey = '';
  if (needsKey) {
    const secretKeyMap: Record<ProviderId, string> = {
      gemini: 'gemini.apiKey',
      claude: 'claude.apiKey',
      deepseek: 'deepseek.apiKey',
      openrouter: 'openrouter.apiKey',
      chatgpt: 'openai.apiKey',
      kimi: 'kimi.apiKey',
      glm: 'glm.apiKey',
      minimax: 'minimax.apiKey',
      ollama: '',
    };
    const secretKey = secretKeyMap[provider];
    apiKey = (await readSecret(secretKey, userId)) ?? '';
    if (!apiKey) {
      throw new Error(`${config.name} API key is not configured.`);
    }
  }

  const maxTokens = config.defaultMaxTokens ?? 4096;

  const res = await httpFetch(config.url(apiKey), {
    method: 'POST',
    headers: config.headers(apiKey),
    body: JSON.stringify(config.buildBody(messages, maxTokens)),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${config.name} error ${res.status}: ${text || res.statusText}`);
  }

  const data = await res.json();
  const content = config.extractContent(data);

  if (!content.trim()) {
    throw new Error(`${config.name} returned an empty response`);
  }

  return content;
}

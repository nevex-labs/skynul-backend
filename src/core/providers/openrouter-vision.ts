/**
 * OpenRouter vision provider — OpenAI-compatible Chat Completions API.
 */

import { buildApiKeyVisionRequest, createVisionProvider } from './base-vision';
import { toOpenAIVisionMessages } from './vision-utils';

const MAX_RETRIES = 1;

export const openrouterVisionRespond = createVisionProvider({
  name: 'OpenRouter',
  maxRetries: MAX_RETRIES,
  buildRequest: (opts) =>
    buildApiKeyVisionRequest({
      ...opts,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      keyName: 'openrouter.apiKey',
      buildBody: (o) => ({
        model: 'openai/gpt-4o-mini',
        max_tokens: 4096,
        messages: toOpenAIVisionMessages(o.systemPrompt, o.messages),
      }),
    }),
  extractContent: (data) =>
    (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
  extractUsage: (data) => {
    const u = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    if (typeof u?.prompt_tokens === 'number' && typeof u?.completion_tokens === 'number') {
      return { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens };
    }
    return undefined;
  },
});

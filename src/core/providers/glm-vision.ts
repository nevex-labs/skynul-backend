/**
 * GLM vision provider — Zhipu AI (GLM) OpenAI-compatible chat completions.
 */

import { buildApiKeyVisionRequest, createVisionProvider } from './base-vision';
import { toOpenAIVisionMessages } from './vision-utils';

const MAX_RETRIES = 1;

export const glmVisionRespond = createVisionProvider({
  name: 'GLM',
  maxRetries: MAX_RETRIES,
  buildRequest: (opts) =>
    buildApiKeyVisionRequest({
      ...opts,
      url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      keyName: 'glm.apiKey',
      buildBody: (o) => ({
        model: 'glm-4v-plus',
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

/**
 * MiniMax vision provider.
 *
 * NOTE: This assumes an OpenAI-compatible chat completions endpoint that
 * accepts multimodal `content` parts (text + image_url). If your MiniMax
 * account uses a different payload shape, adjust the config.
 */

import { buildApiKeyVisionRequest, createVisionProvider } from './base-vision';
import { toOpenAIVisionMessages } from './vision-utils';

const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID || '';
const MAX_RETRIES = 1;

export const minimaxVisionRespond = createVisionProvider({
  name: 'MiniMax',
  maxRetries: MAX_RETRIES,
  buildRequest: (opts) =>
    buildApiKeyVisionRequest({
      ...opts,
      url: 'https://api.minimax.chat/v1/chat/completions',
      keyName: 'minimax.apiKey',
      extraHeaders: MINIMAX_GROUP_ID ? { 'X-Group-Id': MINIMAX_GROUP_ID } : undefined,
      buildBody: (o) => ({
        model: process.env.MINIMAX_VISION_MODEL || 'MiniMax-M2.5',
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

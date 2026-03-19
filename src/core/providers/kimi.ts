/**
 * Kimi chat provider — Anthropic-compatible Messages API
 * Endpoint: https://api.kimi.com/coding/v1/messages
 */

import { createChatProvider } from './base-chat';

export const kimiRespond = createChatProvider({
  name: 'Kimi',
  url: 'https://api.kimi.com/coding/v1/messages',
  model: 'kimi-for-coding',
  headers: (dynamic) => ({
    'x-api-key': dynamic,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  }),
  buildBody: (messages, model, maxTokens) => ({ model, max_tokens: maxTokens, messages }),
  extractContent: (data) =>
    (data as { content?: Array<{ type: string; text?: string }> }).content?.find((c) => c.type === 'text')?.text ?? '',
});

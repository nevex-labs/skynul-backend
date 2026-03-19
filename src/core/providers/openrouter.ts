/**
 * OpenRouter chat provider — OpenAI-compatible Chat Completions API.
 */

import { createChatProvider } from './base-chat';

export const openrouterRespond = createChatProvider({
  name: 'OpenRouter',
  url: 'https://openrouter.ai/api/v1/chat/completions',
  model: 'openrouter/auto',
  headers: (dynamic) => ({ Authorization: `Bearer ${dynamic}`, 'Content-Type': 'application/json' }),
  buildBody: (messages, model, maxTokens) => ({ model, max_tokens: maxTokens, messages }),
  extractContent: (data) =>
    (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
});

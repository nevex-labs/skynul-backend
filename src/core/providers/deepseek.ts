/**
 * DeepSeek chat provider — OpenAI-compatible Chat Completions API
 */

import { createChatProvider } from './base-chat';

export const deepseekRespond = createChatProvider({
  name: 'DeepSeek',
  url: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-chat',
  headers: (dynamic) => ({ Authorization: `Bearer ${dynamic}`, 'Content-Type': 'application/json' }),
  buildBody: (messages, model, maxTokens) => ({ model, max_tokens: maxTokens, messages }),
  extractContent: (data) =>
    (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
});

/**
 * GLM chat provider — Zhipu AI (GLM) OpenAI-compatible chat completions.
 */

import { createChatProvider } from './base-chat';

export const glmRespond = createChatProvider({
  name: 'GLM',
  url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  model: 'glm-4-plus',
  headers: (dynamic) => ({ Authorization: `Bearer ${dynamic}`, 'Content-Type': 'application/json' }),
  buildBody: (messages, model, maxTokens) => ({ model, max_tokens: maxTokens, messages }),
  extractContent: (data) =>
    (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
});

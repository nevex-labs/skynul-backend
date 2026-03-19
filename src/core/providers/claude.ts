/**
 * Claude chat provider — Anthropic Messages API
 */

import { createChatProvider } from './base-chat';

export const claudeRespond = createChatProvider({
  name: 'Claude',
  url: 'https://api.anthropic.com/v1/messages',
  model: 'claude-sonnet-4-20250514',
  headers: (dynamic) => ({
    'x-api-key': dynamic,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  }),
  buildBody: (messages, model, maxTokens) => ({ model, max_tokens: maxTokens, messages }),
  extractContent: (data) =>
    (data as { content?: Array<{ type: string; text?: string }> }).content?.find((c) => c.type === 'text')?.text ?? '',
});

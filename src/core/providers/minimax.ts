/**
 * MiniMax chat provider.
 *
 * NOTE: MiniMax API has multiple variants. This implementation assumes an
 * OpenAI-compatible chat completions endpoint. If your account uses a different
 * endpoint or requires a Group/Project header, set env vars accordingly.
 */

import { createChatProvider } from './base-chat';

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M2.5';
const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID || '';

export const minimaxRespond = createChatProvider({
  name: 'MiniMax',
  url: `${MINIMAX_BASE_URL}/chat/completions`,
  model: MINIMAX_MODEL,
  headers: (dynamic) => {
    const h: Record<string, string> = { Authorization: `Bearer ${dynamic}`, 'Content-Type': 'application/json' };
    if (MINIMAX_GROUP_ID) h['X-Group-Id'] = MINIMAX_GROUP_ID;
    return h;
  },
  buildBody: (messages, model, maxTokens) => ({ model, max_tokens: maxTokens, messages }),
  extractContent: (data) =>
    (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '',
});

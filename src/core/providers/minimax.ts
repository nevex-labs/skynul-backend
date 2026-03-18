/**
 * MiniMax chat provider.
 *
 * NOTE: MiniMax API has multiple variants. This implementation assumes an
 * OpenAI-compatible chat completions endpoint. If your account uses a different
 * endpoint or requires a Group/Project header, set env vars accordingly.
 */

import type { ChatMessage } from '../../types';

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M2.5';
const MINIMAX_GROUP_ID = process.env.MINIMAX_GROUP_ID || '';

type OpenAIChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function minimaxRespond(opts: {
  apiKey: string;
  messages: ChatMessage[];
}): Promise<string> {
  const { apiKey, messages } = opts;
  const truncated = messages.slice(-20);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // Some MiniMax setups require a group/project id header.
  if (MINIMAX_GROUP_ID) headers['X-Group-Id'] = MINIMAX_GROUP_ID;

  const res = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      max_tokens: 4096,
      messages: truncated.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`MiniMax error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`);
  }

  const data = (await res.json()) as OpenAIChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new Error('MiniMax returned an empty response');
  return content;
}

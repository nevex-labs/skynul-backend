/**
 * DeepSeek chat provider — OpenAI-compatible Chat Completions API
 */

import type { ChatMessage } from '../../types';

export async function deepseekRespond(opts: {
  apiKey: string;
  messages: ChatMessage[];
}): Promise<string> {
  const { apiKey, messages } = opts;
  const truncated = messages.slice(-20);

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 4096,
      messages: truncated.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DeepSeek error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new Error('DeepSeek returned an empty response');
  return content;
}

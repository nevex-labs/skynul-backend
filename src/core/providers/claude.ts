/**
 * Claude chat provider — Anthropic Messages API
 */

import type { ChatMessage } from '../../types';

export async function claudeRespond(opts: {
  apiKey: string;
  messages: ChatMessage[];
}): Promise<string> {
  const { apiKey, messages } = opts;
  const truncated = messages.slice(-20);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: truncated.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Claude error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const content = data.content?.find((c) => c.type === 'text')?.text ?? '';
  if (!content.trim()) throw new Error('Claude returned an empty response');
  return content;
}

/**
 * Claude vision provider — Anthropic Messages API via direct API key.
 */

import { getSecret } from '../../services/secrets';
import { createVisionProvider } from './base-vision';
import { toText } from './vision-utils';

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

function toAnthropicParts(content: { type: string; image_url?: string; text?: string }[]): ContentBlock[] {
  const parts: ContentBlock[] = [];
  for (const part of content) {
    if (part.type === 'input_image' && part.image_url) {
      const match = part.image_url.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match?.[1] && match[2]) {
        parts.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
      }
    } else if (part.text) {
      parts.push({ type: 'text', text: part.text });
    }
  }
  return parts;
}

export const claudeVisionRespond = createVisionProvider({
  name: 'Claude',
  maxRetries: 3,
  buildRequest: async (opts) => {
    const apiKey = await getSecret('claude.apiKey');
    if (!apiKey) throw new Error('Claude API key is not set. Configure it in Settings.');
    const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }> = [];
    for (const m of opts.messages) {
      if (m.role === 'assistant') {
        anthropicMessages.push({ role: 'assistant', content: toText(m) });
      } else {
        anthropicMessages.push({ role: 'user', content: toAnthropicParts(m.content) });
      }
    }
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: {
        model: process.env.CLAUDE_VISION_MODEL ?? 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        system: opts.systemPrompt,
        messages: anthropicMessages,
      },
    };
  },
  extractContent: (data) =>
    (data as { content?: Array<{ type: string; text?: string }> }).content?.find((c) => c.type === 'text')?.text ?? '',
  extractUsage: (data) => {
    const u = (data as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    if (typeof u?.input_tokens === 'number' && typeof u?.output_tokens === 'number') {
      return { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
    }
    return undefined;
  },
});

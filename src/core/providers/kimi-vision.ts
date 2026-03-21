/**
 * Kimi K2.5 vision provider — Anthropic-compatible messages API
 * at api.kimi.com/coding/v1/messages.
 *
 * K2.5 is a native multimodal model that supports text + image input.
 * Images are sent as base64 in Anthropic's image content block format.
 */

import type { VisionMessage } from '../../types';
import { getSecret } from '../stores/secret-store';
import { createVisionProvider } from './base-vision';
import { toText } from './vision-utils';

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export const kimiVisionRespond = createVisionProvider({
  name: 'Kimi',
  maxRetries: 3,
  buildRequest: async (opts) => {
    const apiKey = await getSecret('kimi.apiKey');
    if (!apiKey) throw new Error('Kimi API key is not set. Configure it in Settings.');
    const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }> = [];
    for (const m of opts.messages) {
      if (m.role === 'assistant') {
        anthropicMessages.push({ role: 'assistant', content: toText(m) });
      } else {
        const parts: ContentBlock[] = [];
        for (const part of m.content) {
          if (part.type === 'input_image') {
            const match = part.image_url.match(/^data:(image\/[^;]+);base64,(.+)$/);
            if (match) parts.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
          } else {
            parts.push({ type: 'text', text: part.text });
          }
        }
        anthropicMessages.push({ role: 'user', content: parts });
      }
    }
    return {
      url: 'https://api.kimi.com/coding/v1/messages',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: { model: 'k2p5', max_tokens: 4096, system: opts.systemPrompt, messages: anthropicMessages },
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

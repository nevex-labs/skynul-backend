/**
 * GLM vision provider — Zhipu AI (GLM) OpenAI-compatible chat completions.
 */

import { getSecret } from '../stores/secret-store';
import type { VisionMessage } from './codex-vision';

type ImageUrlPart = { type: 'image_url'; image_url: { url: string } };
type TextPart = { type: 'text'; text: string };

type GLMMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<TextPart | ImageUrlPart>;
};

type OpenAIChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function toText(m: VisionMessage): string {
  return m.content
    .filter((p) => p.type === 'output_text' || p.type === 'input_text')
    .map((p) => p.text)
    .join('');
}

function toGLMMessages(systemPrompt: string, messages: VisionMessage[]): GLMMessage[] {
  const out: GLMMessage[] = [{ role: 'system', content: systemPrompt }];

  for (const m of messages.slice(-10)) {
    if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: toText(m) });
      continue;
    }

    const parts: Array<TextPart | ImageUrlPart> = [];
    for (const part of m.content) {
      if (part.type === 'input_image') {
        parts.push({ type: 'image_url', image_url: { url: part.image_url } });
      } else {
        parts.push({ type: 'text', text: part.text });
      }
    }
    out.push({ role: 'user', content: parts });
  }

  return out;
}

export async function glmVisionRespond(opts: {
  systemPrompt: string;
  messages: VisionMessage[];
}): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
  const apiKey = await getSecret('glm.apiKey');
  if (!apiKey) throw new Error('GLM API key is not set. Configure it in Settings.');

  const glmMessages = toGLMMessages(opts.systemPrompt, opts.messages);

  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'glm-4v-plus',
      max_tokens: 4096,
      messages: glmMessages,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GLM vision error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`);
  }

  const data = (await res.json()) as OpenAIChatCompletionResponse;
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new Error('GLM vision returned an empty response');

  const inputTokens = data.usage?.prompt_tokens;
  const outputTokens = data.usage?.completion_tokens;
  const usage =
    typeof inputTokens === 'number' && typeof outputTokens === 'number' ? { inputTokens, outputTokens } : undefined;

  return { text, usage };
}

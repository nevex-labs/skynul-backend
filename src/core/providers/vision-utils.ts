/**
 * Shared utilities for vision providers.
 */

import type { VisionMessage } from '../../shared/types';

export type EdgeContentPart = { type: 'text'; text: string } | { type: 'image'; mediaType: string; base64: string };
export type EdgeMessage = { role: 'user' | 'assistant'; content: string | EdgeContentPart[] };

export function convertToEdgeMessages(messages: VisionMessage[]): EdgeMessage[] {
  return messages.map((msg) => {
    const parts: EdgeContentPart[] = msg.content.map((part) => {
      if (part.type === 'input_image') {
        const dataUrl = part.image_url;
        const commaIdx = dataUrl.indexOf(',');
        const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
        const mediaType = dataUrl.startsWith('data:') ? dataUrl.slice(5, dataUrl.indexOf(';')) : 'image/png';
        return { type: 'image' as const, mediaType, base64 };
      }
      return { type: 'text' as const, text: part.text };
    });
    return { role: msg.role, content: parts };
  });
}

export type OpenAIVisionPart = { type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string };
export type OpenAIVisionMessage = { role: 'system' | 'user' | 'assistant'; content: string | OpenAIVisionPart[] };

export function toText(m: VisionMessage): string {
  return m.content
    .filter((p) => p.type === 'output_text' || p.type === 'input_text')
    .map((p) => p.text)
    .join('');
}

export function toOpenAIVisionMessages(systemPrompt: string, messages: VisionMessage[]): OpenAIVisionMessage[] {
  const out: OpenAIVisionMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: toText(m) });
      continue;
    }
    const parts: OpenAIVisionPart[] = [];
    for (const part of m.content) {
      if (part.type === 'input_image') parts.push({ type: 'image_url', image_url: { url: part.image_url } });
      else parts.push({ type: 'text', text: part.text });
    }
    out.push({ role: 'user', content: parts });
  }
  return out;
}

export function extractDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (m) return { mimeType: m[1], base64: m[2] };
  return { mimeType: 'image/png', base64: dataUrl };
}

export async function retryOn429<T>(fn: () => Promise<Response>, name: string): Promise<Response> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fn();
    if (res.status !== 429) return res;
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, Math.min(15_000 * (attempt + 1), 60_000)));
    } else {
      const txt = await res.text().catch(() => '');
      throw new Error(
        `${name} vision error: 429 Too Many Requests after ${MAX_RETRIES} retries${txt ? ` - ${txt}` : ''}`
      );
    }
  }
  throw new Error(`${name} vision error: 429 retry loop error`);
}

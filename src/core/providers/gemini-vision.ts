/**
 * Gemini vision provider — Google Generative Language API (generateContent).
 */

import type { VisionMessage } from '../../shared/types';
import { createVisionProvider } from './base-vision';
import { getSecret } from './secret-adapter';
import { extractDataUrl, toText } from './vision-utils';

const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.0-flash';

export const geminiVisionRespond = createVisionProvider({
  name: 'Gemini',
  maxRetries: 1,
  buildRequest: async (opts) => {
    const apiKey = await getSecret('gemini.apiKey');
    if (!apiKey) throw new Error('Gemini API key is not set. Configure it in Settings.');
    const contents: Array<{ role: 'user' | 'model'; parts: unknown[] }> = [];
    if (opts.systemPrompt.trim()) contents.push({ role: 'user', parts: [{ text: opts.systemPrompt }] });
    for (const m of opts.messages) {
      if (m.role === 'assistant') {
        contents.push({ role: 'model', parts: [{ text: toText(m) }] });
        continue;
      }
      const parts: unknown[] = [];
      const text = toText(m);
      if (text.trim()) parts.push({ text });
      for (const part of m.content) {
        if (part.type !== 'input_image') continue;
        const { mimeType, base64 } = extractDataUrl(part.image_url);
        parts.push({ inlineData: { mimeType, data: base64 } });
      }
      contents.push({ role: 'user', parts });
    }
    return {
      url: `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_VISION_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      headers: { 'Content-Type': 'application/json' },
      body: { contents, generationConfig: { maxOutputTokens: 4096 } },
    };
  },
  extractContent: (data) =>
    (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('') ?? '',
});

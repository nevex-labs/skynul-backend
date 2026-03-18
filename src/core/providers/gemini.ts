/**
 * Gemini chat provider — Google Generative Language API (generateContent).
 */

import type { ChatMessage } from '../../types';

const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

export async function geminiRespond(opts: {
  apiKey: string;
  messages: ChatMessage[];
}): Promise<string> {
  const { apiKey, messages } = opts;
  const truncated = messages.slice(-20);

  const contents = truncated.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        maxOutputTokens: 4096,
      },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Gemini error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) throw new Error('Gemini returned an empty response');
  return text;
}

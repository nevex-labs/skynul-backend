/**
 * Gemini chat provider — Google Generative Language API (generateContent).
 *
 * API key is embedded in the URL query param rather than headers.
 */

import { createChatProvider } from './base-chat';

const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

export const geminiRespond = createChatProvider({
  name: 'Gemini',
  url: (apiKey) =>
    `${GEMINI_BASE_URL}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
  headers: () => ({ 'Content-Type': 'application/json' }),
  buildBody: (messages, _model, maxTokens) => ({
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { maxOutputTokens: maxTokens },
  }),
  extractContent: (data) =>
    (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('') ?? '',
});

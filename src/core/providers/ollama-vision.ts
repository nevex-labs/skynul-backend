/**
 * Ollama vision provider — native Ollama API with JSON mode (local).
 */

import { getSecret } from '../stores/secret-store';
import { createVisionProvider } from './base-vision';
import type { VisionMessage } from './codex-vision';
import { toText } from './vision-utils';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3.5:27b';

function reinforceJsonFormat(systemPrompt: string): string {
  return (
    `CRITICAL: You MUST respond with ONLY a single valid JSON object. No text before or after.
The JSON MUST have this exact structure: {"thought": "your reasoning here", "action": {"type": "ACTION_TYPE", ...params}}
Valid action types: navigate, click, type, pressKey, scroll, scrollIntoView, evaluate, wait, done, fail, screenshot, shell.
Example: {"thought": "I need to open google", "action": {"type": "navigate", "url": "https://google.com"}}
Example: {"thought": "I see a search box", "action": {"type": "click", "selector": "#search"}}
Example: {"thought": "Task complete", "action": {"type": "done", "summary": "Finished the task"}}
DO NOT write explanations. DO NOT use markdown. ONLY output the JSON object.\n\n` + systemPrompt
  );
}

export const ollamaVisionRespond = createVisionProvider({
  name: 'Ollama',
  maxRetries: 1,
  buildRequest: async (opts) => {
    const baseUrl = (await getSecret('ollama.baseUrl')) || DEFAULT_BASE_URL;
    const model = (await getSecret('ollama.model')) || DEFAULT_MODEL;
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: reinforceJsonFormat(opts.systemPrompt) },
    ];
    const sliced = opts.messages;
    for (let i = 0; i < sliced.length; i++) {
      const m = sliced[i];
      let content = toText(m);
      if (m.role === 'user' && i === sliced.length - 1) {
        content += '\n\nRemember: respond with ONLY a JSON object like {"thought":"...","action":{"type":"..."}}';
      }
      messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
    }
    return {
      url: `${baseUrl}/api/chat`,
      headers: { 'Content-Type': 'application/json' },
      body: { model, messages, format: 'json', stream: false },
    };
  },
  extractContent: (data) => (data as { message?: { content?: string } }).message?.content ?? '',
});

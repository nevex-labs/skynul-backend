/**
 * Ollama vision provider — native Ollama API with JSON mode (local).
 */

import { getSecret } from '../stores/secret-store';
import type { VisionMessage } from './codex-vision';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3.5:27b';

type OllamaChatResponse = {
  message?: { content?: string };
};

function toText(m: VisionMessage): string {
  return m.content
    .filter((p) => p.type === 'output_text' || p.type === 'input_text')
    .map((p) => p.text)
    .join('');
}

/**
 * Prepend a reinforcement to the system prompt so small models
 * consistently return the expected JSON shape.
 */
function reinforceJsonFormat(systemPrompt: string): string {
  const reinforcement = `CRITICAL: You MUST respond with ONLY a single valid JSON object. No text before or after.
The JSON MUST have this exact structure: {"thought": "your reasoning here", "action": {"type": "ACTION_TYPE", ...params}}
Valid action types: navigate, click, type, pressKey, scroll, scrollIntoView, evaluate, wait, done, fail, screenshot, shell.
Example: {"thought": "I need to open google", "action": {"type": "navigate", "url": "https://google.com"}}
Example: {"thought": "I see a search box", "action": {"type": "click", "selector": "#search"}}
Example: {"thought": "Task complete", "action": {"type": "done", "summary": "Finished the task"}}
DO NOT write explanations. DO NOT use markdown. ONLY output the JSON object.\n\n`;
  return reinforcement + systemPrompt;
}

export async function ollamaVisionRespond(opts: {
  systemPrompt: string;
  messages: VisionMessage[];
}): Promise<{ text: string }> {
  const baseUrl = (await getSecret('ollama.baseUrl')) || DEFAULT_BASE_URL;
  const model = (await getSecret('ollama.model')) || DEFAULT_MODEL;

  const messages: Array<{ role: string; content: string }> = [];

  messages.push({ role: 'system', content: reinforceJsonFormat(opts.systemPrompt) });

  const sliced = opts.messages.slice(-10);
  for (let i = 0; i < sliced.length; i++) {
    const m = sliced[i];
    let content = toText(m);
    // Append JSON reminder to the last user message so the model doesn't lose track
    if (m.role === 'user' && i === sliced.length - 1) {
      content += '\n\nRemember: respond with ONLY a JSON object like {"thought":"...","action":{"type":"..."}}';
    }
    messages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content,
    });
  }

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      format: 'json',
      stream: false,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Ollama error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`);
  }

  const data = (await res.json()) as OllamaChatResponse;
  const text = data.message?.content ?? '';
  if (!text.trim()) throw new Error('Ollama returned an empty response');
  return { text };
}

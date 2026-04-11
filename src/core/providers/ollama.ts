/**
 * Ollama chat provider — native /api/chat with JSON mode (local).
 *
 * No auth required; baseUrl and model come from secrets or defaults.
 */

import { getSecret } from '../../services/secrets';
import type { ChatMessage } from '../../types';
import { createChatProvider } from './base-chat';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen2.5:7b';

export const ollamaRespond = createChatProvider({
  name: 'Ollama',
  url: (baseUrl) => `${baseUrl}/api/chat`,
  buildBody: (messages, model, _maxTokens) => ({ model, messages, format: 'json', stream: false }),
  extractContent: (data) => (data as { message?: { content?: string } }).message?.content ?? '',
});

export async function ollamaChat({ messages }: { messages: ChatMessage[] }): Promise<string> {
  const baseUrl = (await getSecret('ollama.baseUrl')) || DEFAULT_BASE_URL;
  const model = (await getSecret('ollama.model')) || DEFAULT_MODEL;
  return ollamaRespond({ dynamic: baseUrl, model, messages });
}

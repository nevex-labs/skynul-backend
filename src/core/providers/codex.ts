import type { ChatMessage } from '../../types';
import {
  CHATGPT_CODEX_API_ENDPOINT,
  type StoredTokens,
  buildAuthorizeUrl,
  clearTokens,
  exchangeCodeForTokens,
  generatePKCE,
  generateState,
  loadTokens,
  refreshIfNeeded,
  saveTokens,
} from './chatgpt-oauth';
import { parseSSE } from './sse';

export {
  buildAuthorizeUrl,
  clearTokens,
  exchangeCodeForTokens,
  generatePKCE,
  generateState,
  loadTokens,
  saveTokens,
  type StoredTokens,
};

export async function codexRespond(opts: { messages: ChatMessage[] }): Promise<string> {
  let tokens = await loadTokens();
  if (!tokens?.access) throw new Error('ChatGPT: not connected. Sign in from Settings.');

  tokens = await refreshIfNeeded(tokens);
  await saveTokens(tokens);

  const truncated = opts.messages.slice(-20);
  const input = truncated.map((m) => ({
    role: m.role,
    content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }],
  }));

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.access}`,
    'Content-Type': 'application/json',
    originator: 'skynul',
  };
  if (tokens.accountId) headers['ChatGPT-Account-Id'] = tokens.accountId;

  const res = await fetch(CHATGPT_CODEX_API_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'gpt-5.2',
      max_output_tokens: 8192,
      instructions: 'You are a helpful assistant.',
      store: false,
      stream: true,
      input,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`ChatGPT Codex error: ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ''}`);
  }

  let accumulated = '';
  for await (const evt of parseSSE(res)) {
    if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
      accumulated += evt.delta;
    }
    if (evt.type === 'response.output_item.done') {
      const item = evt.item as { content?: Array<{ type: string; text?: string }> } | undefined;
      if (item?.content) {
        for (const c of item.content) {
          if (c.type === 'output_text' && typeof c.text === 'string' && !accumulated) accumulated += c.text;
        }
      }
    }
    if (evt.type === 'response.done' || evt.type === 'response.completed') break;
  }

  if (!accumulated.trim()) throw new Error('ChatGPT returned an empty response');
  return accumulated;
}

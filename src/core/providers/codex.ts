import type { ChatMessage } from '../../types';
import {
  buildAuthorizeUrl,
  CHATGPT_CODEX_API_ENDPOINT,
  clearTokens,
  exchangeCodeForTokens,
  generatePKCE,
  generateState,
  loadTokens,
  refreshIfNeeded,
  type StoredTokens,
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
  type StoredTokens,
  saveTokens,
};

function accumulateSSEEvent(evt: Record<string, unknown>, accumulated: string): string {
  if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
    return accumulated + evt.delta;
  }
  if (evt.type === 'response.output_item.done' && !accumulated) {
    const item = evt.item as { content?: Array<{ type: string; text?: string }> } | undefined;
    const textPart = item?.content?.find((c) => c.type === 'output_text' && typeof c.text === 'string');
    if (textPart?.text) return textPart.text;
  }
  return accumulated;
}

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
    accumulated = accumulateSSEEvent(evt, accumulated);
    if (evt.type === 'response.done' || evt.type === 'response.completed') break;
  }

  if (!accumulated.trim()) throw new Error('ChatGPT returned an empty response');
  return accumulated;
}

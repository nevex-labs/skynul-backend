import { getSecret } from '../../services/secrets';
import type { ChatMessage, ProviderId } from '../../types';
import { claudeRespond } from './claude';
import { codexRespond, loadTokens } from './codex';
import { ollamaChat } from './ollama';
import { openrouterRespond } from './openrouter';

async function dispatchChatGPT(messages: ChatMessage[]): Promise<string> {
  const tokens = await loadTokens();
  if (tokens?.access) return codexRespond({ messages });

  const apiKey = await getSecret('openai.apiKey');
  if (!apiKey) throw new Error('ChatGPT is not connected. Sign in via /api/ai/chatgpt/oauth or set openai.apiKey.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-4.1-mini', messages: messages.slice(-20) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

export async function dispatchChat(provider: ProviderId, messages: ChatMessage[]): Promise<string> {
  if (provider === 'chatgpt') return dispatchChatGPT(messages);
  if (provider === 'ollama') return ollamaChat({ messages });

  const KEY_MAP: Record<string, string> = {
    claude: 'claude.apiKey',
    openrouter: 'openrouter.apiKey',
  };

  const keyName = KEY_MAP[provider];
  if (!keyName) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = await getSecret(keyName);
  if (!apiKey) throw new Error(`${provider} API key is not set. Go to Settings and add it.`);

  if (provider === 'claude') return claudeRespond({ dynamic: apiKey, messages });
  return openrouterRespond({ dynamic: apiKey, messages });
}

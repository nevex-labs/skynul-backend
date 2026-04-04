import type { ChatMessage, ProviderId } from '../../types';
import { claudeRespond } from './claude';
import { codexRespond, loadTokens } from './codex';
import { deepseekRespond } from './deepseek';
import { geminiRespond } from './gemini';
import { glmRespond } from './glm';
import { kimiRespond } from './kimi';
import { minimaxRespond } from './minimax';
import { ollamaChat } from './ollama';
import { openrouterRespond } from './openrouter';
import { getSecret } from './secret-adapter';

const PROVIDER_KEYS: Record<string, string | undefined> = {
  claude: 'claude.apiKey',
  deepseek: 'deepseek.apiKey',
  kimi: 'kimi.apiKey',
  glm: 'glm.apiKey',
  minimax: 'minimax.apiKey',
  openrouter: 'openrouter.apiKey',
  gemini: 'gemini.apiKey',
  ollama: undefined,
};

const RESPOND: Record<string, (opts: { dynamic: string; messages: ChatMessage[] }) => Promise<string>> = {
  claude: (o) => claudeRespond(o),
  deepseek: (o) => deepseekRespond(o),
  kimi: (o) => kimiRespond(o),
  glm: (o) => glmRespond(o),
  minimax: (o) => minimaxRespond(o),
  openrouter: (o) => openrouterRespond(o),
  gemini: (o) => geminiRespond(o),
};

export async function dispatchChat(provider: ProviderId, messages: ChatMessage[]): Promise<string> {
  if (provider === 'chatgpt') {
    const tokens = await loadTokens();
    if (tokens?.access) {
      return codexRespond({ messages });
    }

    const apiKey = await getSecret('openai.apiKey');
    if (!apiKey) {
      throw new Error('Provider not connected. Sign in via Settings or set openai.apiKey.');
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-4.1-mini', max_tokens: 8192, messages: messages.slice(-20) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }

  const keyName = PROVIDER_KEYS[provider];
  if (keyName === undefined) {
    if (provider === 'ollama') return ollamaChat({ messages });
    throw new Error(`Unknown provider: ${provider}`);
  }

  const apiKey = await getSecret(keyName);
  if (!apiKey) throw new Error(`${keyName.split('.')[0]} API key is not set. Go to Settings and add it.`);

  return RESPOND[provider]({ dynamic: apiKey, messages });
}

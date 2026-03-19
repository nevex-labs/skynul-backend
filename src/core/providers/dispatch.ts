import type { ChatMessage, ProviderId } from '../../types';
import { getSecret } from '../stores/secret-store';
import { claudeRespond } from './claude';
import { deepseekRespond } from './deepseek';
import { geminiRespond } from './gemini';
import { glmRespond } from './glm';
import { kimiRespond } from './kimi';
import { minimaxRespond } from './minimax';
import { ollamaChat } from './ollama';
import { openrouterRespond } from './openrouter';

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
    const apiKey = await getSecret('openai.apiKey');
    if (!apiKey) {
      throw new Error(
        'ChatGPT OAuth is only available in desktop mode. ' +
          'Set an OpenAI API key in Settings to use this provider via the API.'
      );
    }
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

  const keyName = PROVIDER_KEYS[provider];
  if (keyName === undefined) {
    if (provider === 'ollama') return ollamaChat({ messages });
    throw new Error(`Unknown provider: ${provider}`);
  }

  const apiKey = await getSecret(keyName);
  if (!apiKey) throw new Error(`${keyName.split('.')[0]} API key is not set. Go to Settings and add it.`);

  return RESPOND[provider]({ dynamic: apiKey, messages });
}

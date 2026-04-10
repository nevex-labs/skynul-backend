import { getSecretByTypeProvider } from '../db/queries/secrets';
import { getSystemUserId } from '../db/queries/users';
import type { ProviderId } from '../types';

const PROVIDERS: readonly ProviderId[] = ['chatgpt', 'claude', 'openrouter', 'ollama'] as const;

export const LLM_PREFERENCE_TYPE = 'preference';
export const LLM_PREFERENCE_PROVIDER = 'llm';

const INFER_ORDER: readonly ProviderId[] = ['chatgpt', 'claude', 'openrouter', 'ollama'] as const;

function isProviderId(s: string): s is ProviderId {
  return (PROVIDERS as readonly string[]).includes(s);
}

async function hasUsableCredentials(userId: string, p: ProviderId) {
  if (p === 'ollama') return true;
  if (p === 'chatgpt') {
    const key = await getSecretByTypeProvider(userId, 'apiKey', 'openai');
    const oauth = await getSecretByTypeProvider(userId, 'oauth.tokens', 'chatgpt');
    return Boolean(key?.value?.trim() || oauth?.value?.trim());
  }
  const PROVIDER_SECRET: Record<string, string> = {
    claude: 'claude',
    openrouter: 'openrouter',
  };
  const secretProvider = PROVIDER_SECRET[p];
  if (!secretProvider) return false;
  const row = await getSecretByTypeProvider(userId, 'apiKey', secretProvider);
  return Boolean(row?.value?.trim());
}

export async function resolveActiveProvider(userId?: string) {
  const uid = userId ?? (await getSystemUserId());
  const pref = await getSecretByTypeProvider(uid, LLM_PREFERENCE_TYPE, LLM_PREFERENCE_PROVIDER);
  if (pref?.value) {
    const v = pref.value.trim().toLowerCase();
    if (isProviderId(v) && (await hasUsableCredentials(uid, v))) return v;
  }
  for (const p of INFER_ORDER) {
    if (await hasUsableCredentials(uid, p)) return p;
  }
  return 'chatgpt';
}

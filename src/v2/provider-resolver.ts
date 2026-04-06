/**
 * Layer 1: Provider Resolution
 *
 * Determines which LLM provider to use for a given user.
 * Single source of truth: the `secrets` table in PostgreSQL.
 *
 * This module is self-contained. It defines its own contract for
 * accessing secrets — no dependency on legacy code.
 */

export type ProviderId =
  | 'chatgpt'
  | 'claude'
  | 'deepseek'
  | 'kimi'
  | 'glm'
  | 'minimax'
  | 'openrouter'
  | 'gemini'
  | 'ollama';

/**
 * Contract for reading secrets from storage.
 * The implementation is injected — this layer doesn't care how secrets are stored.
 */
import { readSecret } from './secret-reader';
import type { SecretReader } from './secret-reader';

export type { SecretReader } from './secret-reader';

/**
 * Priority order for provider resolution.
 * First provider with a valid API key wins.
 */
export const PROVIDER_PRIORITY: ProviderId[] = [
  'gemini',
  'claude',
  'deepseek',
  'openrouter',
  'chatgpt',
  'kimi',
  'glm',
  'minimax',
  'ollama',
];

/**
 * Mapping from ProviderId to the secret key name.
 * `null` means the provider doesn't need an API key (e.g., ollama).
 */
export const PROVIDER_SECRET_KEYS: Record<ProviderId, string | null> = {
  gemini: 'gemini.apiKey',
  claude: 'claude.apiKey',
  deepseek: 'deepseek.apiKey',
  openrouter: 'openrouter.apiKey',
  chatgpt: 'openai.apiKey',
  kimi: 'kimi.apiKey',
  glm: 'glm.apiKey',
  minimax: 'minimax.apiKey',
  ollama: null,
};

/**
 * Resolve the provider for a user.
 *
 * Strategy: iterate providers in priority order.
 * Return the first one that has an API key via the SecretReader.
 *
 * @param readSecret - Function to read a secret by key name.
 * @param userId - Optional user ID for user-specific secrets.
 * @returns ProviderId - The resolved provider.
 * @throws Error - If no provider has an API key configured.
 */
export async function resolveProvider(readSecret: SecretReader, userId?: number): Promise<ProviderId> {
  for (const provider of PROVIDER_PRIORITY) {
    if (await isConfigured(provider, readSecret, userId)) {
      return provider;
    }
  }

  throw new Error('No LLM provider configured. Add an API key via Settings.');
}

/**
 * Check if a specific provider is configured for a user.
 *
 * @param provider - The provider to check.
 * @param readSecret - Function to read a secret by key name.
 * @param userId - Optional user ID for user-specific secrets.
 * @returns boolean - True if the provider has an API key.
 */
export async function isConfigured(provider: ProviderId, readSecret: SecretReader, userId?: number): Promise<boolean> {
  const secretKey = PROVIDER_SECRET_KEYS[provider];

  // Providers without a key (like ollama) are always "configured"
  if (secretKey === null) return true;

  const key = await readSecret(secretKey, userId);
  return key != null && key.length > 0;
}

/**
 * List all configured providers for a user.
 *
 * @param readSecret - Function to read a secret by key name.
 * @param userId - Optional user ID for user-specific secrets.
 * @returns ProviderId[] - Array of configured providers in priority order.
 */
export async function listConfigured(readSecret: SecretReader, userId?: number): Promise<ProviderId[]> {
  const configured: ProviderId[] = [];

  for (const provider of PROVIDER_PRIORITY) {
    if (await isConfigured(provider, readSecret, userId)) {
      configured.push(provider);
    }
  }

  return configured;
}

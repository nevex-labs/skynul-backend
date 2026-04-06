# Layer 1: Provider Resolution

## Purpose

Determine which LLM provider to use for a given user. **One source of truth**: the `secrets` table in PostgreSQL.

## Contract

```typescript
interface ProviderResolver {
  /**
   * Resolve the provider for a user.
   * 
   * Strategy: iterate providers in priority order.
   * Return the first one that has an API key in the secrets table.
   * 
   * @param userId - Optional user ID. If provided, check user-specific secrets first,
   *                 then fall back to global (user_id=1) secrets.
   * @returns ProviderId - The resolved provider.
   * @throws Error - If no provider has an API key configured.
   */
  resolve(userId?: number): Promise<ProviderId>;
  
  /**
   * Check if a specific provider is configured for a user.
   */
  isConfigured(provider: ProviderId, userId?: number): Promise<boolean>;
  
  /**
   * List all configured providers for a user.
   */
  listConfigured(userId?: number): Promise<ProviderId[]>;
}
```

## Provider Priority Order

```typescript
const PROVIDER_PRIORITY: ProviderId[] = [
  'gemini',      // Free tier, fast, good for most tasks
  'claude',      // High quality, good for complex tasks
  'deepseek',    // Cost-effective alternative
  'openrouter',  // Multi-model access
  'chatgpt',     // OpenAI
  'kimi',        // Moonshot
  'glm',         // Zhipu
  'minimax',     // MiniMax
  'ollama',      // Local, no key needed (always available if running)
];
```

## Secret Key Mapping

```typescript
const PROVIDER_SECRET_KEYS: Record<ProviderId, string | null> = {
  gemini: 'gemini.apiKey',
  claude: 'claude.apiKey',
  deepseek: 'deepseek.apiKey',
  openrouter: 'openrouter.apiKey',
  chatgpt: 'openai.apiKey',
  kimi: 'kimi.apiKey',
  glm: 'glm.apiKey',
  minimax: 'minimax.apiKey',
  ollama: null,  // No key needed
};
```

## Resolution Algorithm

```
1. If userId is provided:
   a. Check secrets table for userId + key
   b. If found → return provider
   c. If not found → check secrets table for user_id=1 (global) + key
   d. If found → return provider

2. If no userId:
   a. Check secrets table for user_id=1 (global) + key
   b. If found → return provider

3. Iterate through PROVIDER_PRIORITY:
   a. For each provider, check if it has a key (using steps 1-2)
   b. Return first provider with a valid key

4. If no provider has a key → throw Error("No LLM provider configured")
```

## What This Layer Does NOT Do

- Does NOT read from `.env` variables
- Does NOT use `policy.provider.active`
- Does NOT use `ProviderSecretsService`
- Does NOT have fallback chains between providers during execution
- Does NOT know about models (each provider manages its own model)

## Dependencies

- `secrets` table (via `SecretService`)
- `ProviderId` type from shared types

## File

```
src/v2/provider-resolver.ts
```

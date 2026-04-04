/**
 * Adapter para reemplazar secret-store.ts con ProviderSecretsService (Effect + PostgreSQL)
 *
 * Expone funciones async/await compatibles con el código legacy de providers,
 * pero usa Effect internamente con el ProviderSecretsService.
 */
import { Effect, Layer } from 'effect';
import { AppLayer } from '../../config/layers';
import { ProviderSecretsService } from '../../services/provider-secrets';

// System user ID for global provider secrets
const SYSTEM_USER_ID = 1;

// Layer con todos los servicios necesarios
const SecretsLayer = AppLayer;

/**
 * Get a provider secret value (decrypted)
 * Compatible con el antiguo secret-store.getSecret()
 */
export async function getSecret(key: string): Promise<string | null> {
  const parts = key.split('.');
  const provider = parts[0];
  const keyName = parts.slice(1).join('.');

  const program = Effect.gen(function* () {
    const service = yield* ProviderSecretsService;
    return yield* service.getSecret(provider, keyName);
  });

  const result = await Effect.runPromiseExit(program.pipe(Effect.provide(SecretsLayer)));

  if (result._tag === 'Success') {
    return result.value;
  }

  console.error('[secret-adapter] getSecret error:', result.cause);
  return null;
}

/**
 * Set a provider secret (encrypted before storage)
 * Compatible con el antiguo secret-store.setSecret()
 */
export async function setSecret(key: string, value: string): Promise<void> {
  const parts = key.split('.');
  const provider = parts[0];
  const keyName = parts.slice(1).join('.');

  const program = Effect.gen(function* () {
    const service = yield* ProviderSecretsService;
    yield* service.setSecret(provider, keyName, value);
  });

  const result = await Effect.runPromiseExit(program.pipe(Effect.provide(SecretsLayer)));

  if (result._tag === 'Failure') {
    console.error('[secret-adapter] setSecret error:', result.cause);
    throw new Error(`Failed to set secret: ${result.cause}`);
  }
}

/**
 * Delete a provider secret
 * Compatible con el antiguo secret-store.deleteSecret()
 */
export async function deleteSecret(key: string): Promise<void> {
  const parts = key.split('.');
  const provider = parts[0];
  const keyName = parts.slice(1).join('.');

  const program = Effect.gen(function* () {
    const service = yield* ProviderSecretsService;
    yield* service.deleteSecret(provider, keyName);
  });

  const result = await Effect.runPromiseExit(program.pipe(Effect.provide(SecretsLayer)));

  if (result._tag === 'Failure') {
    console.error('[secret-adapter] deleteSecret error:', result.cause);
    throw new Error(`Failed to delete secret: ${result.cause}`);
  }
}

/**
 * Check if a provider secret exists
 * Compatible con el antiguo secret-store.hasSecret()
 */
export async function hasSecret(key: string): Promise<boolean> {
  const parts = key.split('.');
  const provider = parts[0];
  const keyName = parts.slice(1).join('.');

  const program = Effect.gen(function* () {
    const service = yield* ProviderSecretsService;
    return yield* service.hasSecret(provider, keyName);
  });

  const result = await Effect.runPromiseExit(program.pipe(Effect.provide(SecretsLayer)));

  if (result._tag === 'Success') {
    return result.value;
  }

  return false;
}

/**
 * Get all secret keys for a provider
 * Compatible con el antiguo secret-store.getSecretKeys()
 */
export async function getSecretKeys(provider: string): Promise<string[]> {
  const program = Effect.gen(function* () {
    const service = yield* ProviderSecretsService;
    return yield* service.getSecretKeys(provider);
  });

  const result = await Effect.runPromiseExit(program.pipe(Effect.provide(SecretsLayer)));

  if (result._tag === 'Success') {
    return result.value;
  }

  console.error('[secret-adapter] getSecretKeys error:', result.cause);
  return [];
}

import { Context, Effect } from 'effect';
import type { ProviderSecret } from '../../infrastructure/db/schema';
import { CryptoError, DatabaseError, SecretNotFoundError } from '../../shared/errors';

export interface ProviderSecretsServiceApi {
  /**
   * Get a provider secret value (decrypted)
   * @param provider - Provider name (e.g., 'openai', 'coinbase', 'binance')
   * @param keyName - Key name (e.g., 'api_key', 'api_secret')
   * @returns The decrypted secret value or null if not found
   */
  readonly getSecret: (provider: string, keyName: string) => Effect.Effect<string | null, DatabaseError | CryptoError>;

  /**
   * Check if a provider secret exists
   */
  readonly hasSecret: (provider: string, keyName: string) => Effect.Effect<boolean, DatabaseError>;

  /**
   * Set a provider secret (encrypted before storage)
   * @param provider - Provider name
   * @param keyName - Key name
   * @param value - Raw value to encrypt and store
   */
  readonly setSecret: (
    provider: string,
    keyName: string,
    value: string
  ) => Effect.Effect<ProviderSecret, DatabaseError | CryptoError>;

  /**
   * Delete a provider secret
   */
  readonly deleteSecret: (
    provider: string,
    keyName: string
  ) => Effect.Effect<void, DatabaseError | SecretNotFoundError>;

  /**
   * List all secrets for a provider (without values)
   */
  readonly listSecrets: (
    provider: string
  ) => Effect.Effect<Pick<ProviderSecret, 'id' | 'provider' | 'keyName' | 'createdAt' | 'updatedAt'>[], DatabaseError>;

  /**
   * List all provider secrets across all providers (without values)
   */
  readonly listAllSecrets: () => Effect.Effect<
    Pick<ProviderSecret, 'id' | 'provider' | 'keyName' | 'createdAt' | 'updatedAt'>[],
    DatabaseError
  >;

  /**
   * Get all secret keys for a provider
   */
  readonly getSecretKeys: (provider: string) => Effect.Effect<string[], DatabaseError>;
}

export class ProviderSecretsService extends Context.Tag('ProviderSecretsService')<
  ProviderSecretsService,
  ProviderSecretsServiceApi
>() {}

import { Context, Effect } from 'effect';
import { CryptoError, DatabaseError, SecretNotFoundError } from '../../shared/errors';

export type ProviderSecretRecord = {
  id: number;
  userId: number;
  provider: string;
  keyName: string;
  encryptedValue: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type ProviderSecretMeta = Pick<ProviderSecretRecord, 'id' | 'provider' | 'keyName' | 'createdAt' | 'updatedAt'>;

export interface ProviderSecretsServiceApi {
  readonly getSecret: (provider: string, keyName: string) => Effect.Effect<string | null, DatabaseError | CryptoError>;

  readonly hasSecret: (provider: string, keyName: string) => Effect.Effect<boolean, DatabaseError>;

  readonly setSecret: (
    provider: string,
    keyName: string,
    value: string
  ) => Effect.Effect<ProviderSecretRecord, DatabaseError | CryptoError>;

  readonly deleteSecret: (
    provider: string,
    keyName: string
  ) => Effect.Effect<void, DatabaseError | SecretNotFoundError>;

  readonly listSecrets: (provider: string) => Effect.Effect<ProviderSecretMeta[], DatabaseError>;

  readonly listAllSecrets: () => Effect.Effect<ProviderSecretMeta[], DatabaseError>;

  readonly getSecretKeys: (provider: string) => Effect.Effect<string[], DatabaseError>;
}

export class ProviderSecretsService extends Context.Tag('ProviderSecretsService')<
  ProviderSecretsService,
  ProviderSecretsServiceApi
>() {}

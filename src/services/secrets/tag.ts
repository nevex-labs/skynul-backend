import { Context, Effect } from 'effect';
import { CryptoError, DatabaseError, SecretNotFoundError } from '../../shared/errors';

export interface SecretValue {
  readonly userId: number;
  readonly keyName: string;
  readonly value: string;
}

export interface SecretMetadata {
  readonly id: number;
  readonly userId: number;
  readonly keyName: string;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
}

export interface SecretServiceApi {
  readonly get: (
    userId: number,
    keyName: string
  ) => Effect.Effect<string, SecretNotFoundError | DatabaseError | CryptoError>;

  readonly set: (value: SecretValue) => Effect.Effect<SecretMetadata, DatabaseError | CryptoError>;

  readonly delete: (
    userId: number,
    keyName: string
  ) => Effect.Effect<void, SecretNotFoundError | DatabaseError | CryptoError>;

  readonly list: (userId: number) => Effect.Effect<SecretMetadata[], DatabaseError>;
}

export class SecretService extends Context.Tag('SecretService')<SecretService, SecretServiceApi>() {}

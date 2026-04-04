import { Context, Effect } from 'effect';
import { CryptoError } from '../../shared/errors';

export interface CryptoServiceApi {
  readonly encrypt: (plainText: string) => Effect.Effect<string, CryptoError>;
  readonly decrypt: (encryptedData: string) => Effect.Effect<string, CryptoError>;
}

export class CryptoService extends Context.Tag('CryptoService')<CryptoService, CryptoServiceApi>() {}

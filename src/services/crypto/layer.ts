import crypto from 'crypto';
import { Config, Effect, Layer } from 'effect';
import { CryptoError } from '../../shared/errors';
import { CryptoService } from './tag';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export const MasterKeyConfig = Config.string('MASTER_KEY');

export const CryptoLive = Layer.effect(
  CryptoService,
  Effect.gen(function* () {
    const masterKey = yield* MasterKeyConfig;

    if (!masterKey || masterKey.length < 32) {
      return yield* Effect.fail(new CryptoError(new Error('Master key must be at least 32 characters')));
    }

    const key = Buffer.from(masterKey.slice(0, 32));

    return CryptoService.of({
      encrypt: (plainText: string) =>
        Effect.try({
          try: () => {
            const iv = crypto.randomBytes(IV_LENGTH);
            const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

            let encrypted = cipher.update(plainText, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            const authTag = cipher.getAuthTag();

            return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
          },
          catch: (error) => new CryptoError(error),
        }),

      decrypt: (encryptedData: string) =>
        Effect.try({
          try: () => {
            const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

            const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));

            decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
          },
          catch: (error) => new CryptoError(error),
        }),
    });
  })
);

// Layer para testing (sin encriptación)
export const CryptoTest = Layer.succeed(
  CryptoService,
  CryptoService.of({
    encrypt: (text) => Effect.succeed(`encrypted:${text}`),
    decrypt: (text) => Effect.succeed(text.replace('encrypted:', '')),
  })
);

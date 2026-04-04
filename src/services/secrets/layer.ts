import { and, eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { APP_SECRET_NAMESPACE, secrets } from '../../infrastructure/db/schema';
import { DatabaseError, SecretNotFoundError } from '../../shared/errors';
import { CryptoService } from '../crypto/tag';
import { DatabaseService } from '../database/tag';
import { SecretService } from './tag';
import type { SecretMetadata, SecretValue } from './tag';

export const SecretServiceLive = Layer.effect(
  SecretService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;
    const crypto = yield* CryptoService;

    return SecretService.of({
      get: (userId: number, keyName: string) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(secrets)
                .where(
                  and(
                    eq(secrets.userId, userId),
                    eq(secrets.namespace, APP_SECRET_NAMESPACE),
                    eq(secrets.keyName, keyName)
                  )
                )
                .limit(1),
            catch: (error) => new DatabaseError(error),
          });

          if (result.length === 0) {
            return yield* Effect.fail(new SecretNotFoundError(keyName));
          }

          const decrypted = yield* crypto.decrypt(result[0].encryptedValue);
          return decrypted;
        }),

      set: (value: SecretValue) =>
        Effect.gen(function* () {
          const encrypted = yield* crypto.encrypt(value.value);

          const result = yield* Effect.tryPromise({
            try: () =>
              db
                .insert(secrets)
                .values({
                  userId: value.userId,
                  namespace: APP_SECRET_NAMESPACE,
                  keyName: value.keyName,
                  encryptedValue: encrypted,
                })
                .onConflictDoUpdate({
                  target: [secrets.userId, secrets.namespace, secrets.keyName],
                  set: {
                    encryptedValue: encrypted,
                    updatedAt: new Date(),
                  },
                })
                .returning({
                  id: secrets.id,
                  userId: secrets.userId,
                  keyName: secrets.keyName,
                  createdAt: secrets.createdAt,
                  updatedAt: secrets.updatedAt,
                }),
            catch: (error) => new DatabaseError(error),
          });

          return result[0] as SecretMetadata;
        }),

      delete: (userId: number, keyName: string) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              db
                .delete(secrets)
                .where(
                  and(
                    eq(secrets.userId, userId),
                    eq(secrets.namespace, APP_SECRET_NAMESPACE),
                    eq(secrets.keyName, keyName)
                  )
                )
                .returning(),
            catch: (error) => new DatabaseError(error),
          });

          if (result.length === 0) {
            return yield* Effect.fail(new SecretNotFoundError(keyName));
          }
        }),

      list: (userId: number) =>
        Effect.tryPromise({
          try: () =>
            db
              .select({
                id: secrets.id,
                userId: secrets.userId,
                keyName: secrets.keyName,
                createdAt: secrets.createdAt,
                updatedAt: secrets.updatedAt,
              })
              .from(secrets)
              .where(and(eq(secrets.userId, userId), eq(secrets.namespace, APP_SECRET_NAMESPACE))),
          catch: (error) => new DatabaseError(error),
        }),
    });
  })
);

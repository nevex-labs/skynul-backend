import { and, eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { providerSecrets } from '../../infrastructure/db/schema';
import { DatabaseError, SecretNotFoundError } from '../../shared/errors';
import { CryptoService } from '../crypto/tag';
import { DatabaseService } from '../database/tag';
import { ProviderSecretsService } from './tag';

// Default user ID for global provider secrets (system user)
const SYSTEM_USER_ID = 1;

export const ProviderSecretsServiceLive = Layer.effect(
  ProviderSecretsService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;
    const crypto = yield* CryptoService;

    return ProviderSecretsService.of({
      getSecret: (provider: string, keyName: string) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [secret] = await db
                .select()
                .from(providerSecrets)
                .where(
                  and(
                    eq(providerSecrets.userId, SYSTEM_USER_ID),
                    eq(providerSecrets.provider, provider),
                    eq(providerSecrets.keyName, keyName)
                  )
                )
                .limit(1);
              return secret || null;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result) {
            return null;
          }

          const decrypted = yield* crypto.decrypt(result.encryptedValue);
          return decrypted;
        }),

      hasSecret: (provider: string, keyName: string) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [secret] = await db
                .select({ id: providerSecrets.id })
                .from(providerSecrets)
                .where(
                  and(
                    eq(providerSecrets.userId, SYSTEM_USER_ID),
                    eq(providerSecrets.provider, provider),
                    eq(providerSecrets.keyName, keyName)
                  )
                )
                .limit(1);
              return !!secret;
            },
            catch: (error) => new DatabaseError(error),
          });

          return result;
        }),

      setSecret: (provider: string, keyName: string, value: string) =>
        Effect.gen(function* () {
          const encrypted = yield* crypto.encrypt(value);

          const result = yield* Effect.tryPromise({
            try: async () => {
              const [secret] = await db
                .insert(providerSecrets)
                .values({
                  userId: SYSTEM_USER_ID,
                  provider,
                  keyName,
                  encryptedValue: encrypted,
                })
                .onConflictDoUpdate({
                  target: [providerSecrets.userId, providerSecrets.provider, providerSecrets.keyName],
                  set: {
                    encryptedValue: encrypted,
                    updatedAt: new Date(),
                  },
                })
                .returning();
              return secret;
            },
            catch: (error) => new DatabaseError(error),
          });

          return result;
        }),

      deleteSecret: (provider: string, keyName: string) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [deleted] = await db
                .delete(providerSecrets)
                .where(
                  and(
                    eq(providerSecrets.userId, SYSTEM_USER_ID),
                    eq(providerSecrets.provider, provider),
                    eq(providerSecrets.keyName, keyName)
                  )
                )
                .returning();
              return deleted;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result) {
            return yield* Effect.fail(new SecretNotFoundError(`${provider}/${keyName}`));
          }
        }),

      listSecrets: (provider: string) =>
        Effect.tryPromise({
          try: async () => {
            return await db
              .select({
                id: providerSecrets.id,
                provider: providerSecrets.provider,
                keyName: providerSecrets.keyName,
                createdAt: providerSecrets.createdAt,
                updatedAt: providerSecrets.updatedAt,
              })
              .from(providerSecrets)
              .where(and(eq(providerSecrets.userId, SYSTEM_USER_ID), eq(providerSecrets.provider, provider)));
          },
          catch: (error) => new DatabaseError(error),
        }),

      listAllSecrets: () =>
        Effect.tryPromise({
          try: async () => {
            return await db
              .select({
                id: providerSecrets.id,
                provider: providerSecrets.provider,
                keyName: providerSecrets.keyName,
                createdAt: providerSecrets.createdAt,
                updatedAt: providerSecrets.updatedAt,
              })
              .from(providerSecrets)
              .where(eq(providerSecrets.userId, SYSTEM_USER_ID));
          },
          catch: (error) => new DatabaseError(error),
        }),

      getSecretKeys: (provider: string) =>
        Effect.gen(function* () {
          const secrets = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select({ keyName: providerSecrets.keyName })
                .from(providerSecrets)
                .where(and(eq(providerSecrets.userId, SYSTEM_USER_ID), eq(providerSecrets.provider, provider)));
            },
            catch: (error) => new DatabaseError(error),
          });

          return secrets.map((s) => s.keyName);
        }),
    });
  })
);

// Layer para testing
export const ProviderSecretsServiceTest = Layer.succeed(
  ProviderSecretsService,
  ProviderSecretsService.of({
    getSecret: () => Effect.succeed(null),
    hasSecret: () => Effect.succeed(false),
    setSecret: (provider, keyName) =>
      Effect.succeed({
        id: 1,
        userId: 1,
        provider,
        keyName,
        encryptedValue: 'encrypted',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    deleteSecret: () => Effect.succeed(undefined),
    listSecrets: () => Effect.succeed([]),
    listAllSecrets: () => Effect.succeed([]),
    getSecretKeys: () => Effect.succeed([]),
  })
);

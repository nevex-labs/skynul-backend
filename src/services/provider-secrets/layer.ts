import { and, eq, sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { PROVIDER_SECRET_NAMESPACE, secrets } from '../../infrastructure/db/schema';
import { DatabaseError, SecretNotFoundError } from '../../shared/errors';
import { CryptoService } from '../crypto/tag';
import { DatabaseService } from '../database/tag';
import { ProviderSecretsService } from './tag';

const SYSTEM_USER_ID = 1;

function storageKey(provider: string, keyName: string): string {
  return `${provider}:${keyName}`;
}

function rowToMeta(row: {
  id: number;
  keyName: string;
  meta: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
}) {
  const meta = row.meta as { provider?: string; logicalKey?: string } | null;
  if (meta?.provider != null && meta.logicalKey != null) {
    return {
      id: row.id,
      provider: meta.provider,
      keyName: meta.logicalKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  const i = row.keyName.indexOf(':');
  const provider = i >= 0 ? row.keyName.slice(0, i) : '';
  const keyName = i >= 0 ? row.keyName.slice(i + 1) : row.keyName;
  return {
    id: row.id,
    provider,
    keyName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const ProviderSecretsServiceLive = Layer.effect(
  ProviderSecretsService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;
    const crypto = yield* CryptoService;

    return ProviderSecretsService.of({
      getSecret: (provider: string, keyName: string) =>
        Effect.gen(function* () {
          const key = storageKey(provider, keyName);
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [secret] = await db
                .select()
                .from(secrets)
                .where(
                  and(
                    eq(secrets.userId, SYSTEM_USER_ID),
                    eq(secrets.namespace, PROVIDER_SECRET_NAMESPACE),
                    eq(secrets.keyName, key)
                  )
                )
                .limit(1);
              return secret ?? null;
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
          const key = storageKey(provider, keyName);
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [row] = await db
                .select({ id: secrets.id })
                .from(secrets)
                .where(
                  and(
                    eq(secrets.userId, SYSTEM_USER_ID),
                    eq(secrets.namespace, PROVIDER_SECRET_NAMESPACE),
                    eq(secrets.keyName, key)
                  )
                )
                .limit(1);
              return !!row;
            },
            catch: (error) => new DatabaseError(error),
          });

          return result;
        }),

      setSecret: (provider: string, keyName: string, value: string) =>
        Effect.gen(function* () {
          const encrypted = yield* crypto.encrypt(value);
          const key = storageKey(provider, keyName);
          const meta = { provider, logicalKey: keyName };

          const result = yield* Effect.tryPromise({
            try: async () => {
              const [secret] = await db
                .insert(secrets)
                .values({
                  userId: SYSTEM_USER_ID,
                  namespace: PROVIDER_SECRET_NAMESPACE,
                  keyName: key,
                  encryptedValue: encrypted,
                  meta,
                })
                .onConflictDoUpdate({
                  target: [secrets.userId, secrets.namespace, secrets.keyName],
                  set: {
                    encryptedValue: encrypted,
                    meta,
                    updatedAt: new Date(),
                  },
                })
                .returning();
              return secret;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result) {
            return yield* Effect.fail(new DatabaseError(new Error('insert provider secret')));
          }

          return {
            id: result.id,
            userId: result.userId,
            provider,
            keyName,
            encryptedValue: result.encryptedValue,
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
          };
        }),

      deleteSecret: (provider: string, keyName: string) =>
        Effect.gen(function* () {
          const key = storageKey(provider, keyName);
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [deleted] = await db
                .delete(secrets)
                .where(
                  and(
                    eq(secrets.userId, SYSTEM_USER_ID),
                    eq(secrets.namespace, PROVIDER_SECRET_NAMESPACE),
                    eq(secrets.keyName, key)
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
            const rows = await db
              .select({
                id: secrets.id,
                keyName: secrets.keyName,
                meta: secrets.meta,
                createdAt: secrets.createdAt,
                updatedAt: secrets.updatedAt,
              })
              .from(secrets)
              .where(
                and(
                  eq(secrets.userId, SYSTEM_USER_ID),
                  eq(secrets.namespace, PROVIDER_SECRET_NAMESPACE),
                  sql`${secrets.meta}->>'provider' = ${provider}`
                )
              );
            return rows.map(rowToMeta);
          },
          catch: (error) => new DatabaseError(error),
        }),

      listAllSecrets: () =>
        Effect.tryPromise({
          try: async () => {
            const rows = await db
              .select({
                id: secrets.id,
                keyName: secrets.keyName,
                meta: secrets.meta,
                createdAt: secrets.createdAt,
                updatedAt: secrets.updatedAt,
              })
              .from(secrets)
              .where(and(eq(secrets.userId, SYSTEM_USER_ID), eq(secrets.namespace, PROVIDER_SECRET_NAMESPACE)));
            return rows.map(rowToMeta);
          },
          catch: (error) => new DatabaseError(error),
        }),

      getSecretKeys: (provider: string) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select({
                  keyName: secrets.keyName,
                  meta: secrets.meta,
                })
                .from(secrets)
                .where(
                  and(
                    eq(secrets.userId, SYSTEM_USER_ID),
                    eq(secrets.namespace, PROVIDER_SECRET_NAMESPACE),
                    sql`${secrets.meta}->>'provider' = ${provider}`
                  )
                );
            },
            catch: (error) => new DatabaseError(error),
          });

          return rows.map((r) => {
            const m = r.meta as { logicalKey?: string } | null;
            if (m?.logicalKey != null) return m.logicalKey;
            const i = r.keyName.indexOf(':');
            return i >= 0 ? r.keyName.slice(i + 1) : r.keyName;
          });
        }),
    });
  })
);

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

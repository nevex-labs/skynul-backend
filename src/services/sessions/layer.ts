import { eq, lt } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { sessions } from '../../infrastructure/db/schema';
import { DatabaseError, SessionNotFoundError } from '../../shared/errors';
import { DatabaseService } from '../database';
import { type SessionInput, SessionService } from './tag';

export const SessionServiceLive = Layer.effect(
  SessionService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    return SessionService.of({
      create: (input) =>
        Effect.tryPromise({
          try: async () => {
            const [session] = await db
              .insert(sessions)
              .values({
                sessionId: input.sessionId,
                accessToken: input.accessToken,
                refreshToken: input.refreshToken,
                expiresAt: new Date(input.expiresAt),
                oauthSubject: input.oauthSubject,
                appUserId: input.appUserId ?? null,
                displayName: input.displayName,
                avatarUrl: input.avatarUrl,
              })
              .returning();
            return session;
          },
          catch: (error) => new DatabaseError(error),
        }),

      getById: (sessionId) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [session] = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId)).limit(1);
              return session;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result) {
            return yield* Effect.fail(new SessionNotFoundError(sessionId));
          }

          // Check if expired
          if (new Date() > result.expiresAt) {
            // Delete expired session (fire and forget, don't wait)
            void db.delete(sessions).where(eq(sessions.sessionId, sessionId));
            return yield* Effect.fail(new SessionNotFoundError(sessionId));
          }

          return result;
        }),

      delete: (sessionId) =>
        Effect.tryPromise({
          try: async () => {
            await db.delete(sessions).where(eq(sessions.sessionId, sessionId));
          },
          catch: (error) => new DatabaseError(error),
        }),

      update: (sessionId, patch) =>
        Effect.gen(function* () {
          const existing = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId)).limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!existing) {
            return yield* Effect.fail(new SessionNotFoundError(sessionId));
          }

          const result = yield* Effect.tryPromise({
            try: async () => {
              const [updated] = await db
                .update(sessions)
                .set({
                  accessToken: patch.accessToken ?? existing.accessToken,
                  refreshToken: patch.refreshToken ?? existing.refreshToken,
                  expiresAt: patch.expiresAt ? new Date(patch.expiresAt) : existing.expiresAt,
                  oauthSubject: patch.oauthSubject ?? existing.oauthSubject,
                  appUserId: patch.appUserId !== undefined ? patch.appUserId : existing.appUserId,
                  displayName: patch.displayName ?? existing.displayName,
                  avatarUrl: patch.avatarUrl ?? existing.avatarUrl,
                  updatedAt: new Date(),
                })
                .where(eq(sessions.sessionId, sessionId))
                .returning();
              return updated;
            },
            catch: (error) => new DatabaseError(error),
          });

          return result!;
        }),

      cleanupExpired: () =>
        Effect.tryPromise({
          try: async () => {
            const result = await db
              .delete(sessions)
              .where(lt(sessions.expiresAt, new Date()))
              .returning({ count: sessions.id });
            return result.length;
          },
          catch: (error) => new DatabaseError(error),
        }),
    });
  })
);

// Layer para testing
export const SessionServiceTest = Layer.succeed(
  SessionService,
  SessionService.of({
    create: (input) =>
      Effect.succeed({
        id: 1,
        sessionId: input.sessionId,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: new Date(input.expiresAt),
        oauthSubject: input.oauthSubject,
        appUserId: input.appUserId ?? null,
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    getById: (id) => Effect.fail(new SessionNotFoundError(id)),
    delete: () => Effect.succeed(undefined),
    update: (id) => Effect.fail(new SessionNotFoundError(id)),
    cleanupExpired: () => Effect.succeed(0),
  })
);

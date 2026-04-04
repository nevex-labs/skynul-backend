import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { browserSnapshots } from '../../infrastructure/db/schema';
import { BrowserSnapshotNotFoundError, DatabaseError } from '../../shared/errors';
import { DatabaseService } from '../database';
import { BrowserSnapshotService } from './tag';

export const BrowserSnapshotServiceLive = Layer.effect(
  BrowserSnapshotService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    return BrowserSnapshotService.of({
      list: () =>
        Effect.tryPromise({
          try: async () => {
            return await db.select().from(browserSnapshots).orderBy(browserSnapshots.createdAt);
          },
          catch: (error) => new DatabaseError(error),
        }),

      create: (name, url, title) =>
        Effect.tryPromise({
          try: async () => {
            const snapshotId = randomUUID();
            const [snapshot] = await db.insert(browserSnapshots).values({ snapshotId, name, url, title }).returning();
            return snapshot;
          },
          catch: (error) => new DatabaseError(error),
        }),

      getById: (snapshotId) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [snapshot] = await db
                .select()
                .from(browserSnapshots)
                .where(eq(browserSnapshots.snapshotId, snapshotId))
                .limit(1);
              return snapshot;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result) {
            return yield* Effect.fail(new BrowserSnapshotNotFoundError(snapshotId));
          }

          return result;
        }),

      delete: (snapshotId) =>
        Effect.tryPromise({
          try: async () => {
            await db.delete(browserSnapshots).where(eq(browserSnapshots.snapshotId, snapshotId));
          },
          catch: (error) => new DatabaseError(error),
        }),
    });
  })
);

// Layer para testing
export const BrowserSnapshotServiceTest = Layer.succeed(
  BrowserSnapshotService,
  BrowserSnapshotService.of({
    list: () => Effect.succeed([]),
    create: (name, url, title) =>
      Effect.succeed({
        id: 1,
        snapshotId: 'test-id',
        name,
        url,
        title,
        createdAt: new Date(),
      }),
    getById: (id) => Effect.fail(new BrowserSnapshotNotFoundError(id)),
    delete: () => Effect.succeed(undefined),
  })
);

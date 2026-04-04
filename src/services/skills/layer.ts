import { and, eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { skills } from '../../infrastructure/db/schema';
import type { Skill } from '../../infrastructure/db/schema';
import { DatabaseError, SkillNotFoundError } from '../../shared/errors';
import { DatabaseService } from '../database';
import { type SkillInput, SkillService } from './tag';

export const SkillServiceLive = Layer.effect(
  SkillService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    const forUser = (userId: number) => and(eq(skills.userId, userId));

    return SkillService.of({
      list: (userId) =>
        Effect.tryPromise({
          try: async () => {
            return await db.select().from(skills).where(forUser(userId)).orderBy(skills.createdAt);
          },
          catch: (error) => new DatabaseError(error),
        }),

      create: (userId, input) =>
        Effect.tryPromise({
          try: async () => {
            const [skill] = await db
              .insert(skills)
              .values({
                userId,
                name: input.name,
                tag: input.tag,
                description: input.description,
                prompt: input.prompt,
                enabled: input.enabled ?? true,
              })
              .returning();
            return skill;
          },
          catch: (error) => new DatabaseError(error),
        }),

      update: (userId, id, input) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [updated] = await db
                .update(skills)
                .set({
                  name: input.name,
                  tag: input.tag,
                  description: input.description,
                  prompt: input.prompt,
                  enabled: input.enabled,
                  updatedAt: new Date(),
                })
                .where(and(eq(skills.id, id), eq(skills.userId, userId)))
                .returning();
              return updated;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result) {
            return yield* Effect.fail(new SkillNotFoundError(id));
          }

          return result;
        }),

      delete: (userId, id) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [deleted] = await db
                .delete(skills)
                .where(and(eq(skills.id, id), eq(skills.userId, userId)))
                .returning();
              return deleted;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result) {
            return yield* Effect.fail(new SkillNotFoundError(id));
          }
        }),

      toggle: (userId, id) =>
        Effect.gen(function* () {
          const skill = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db
                .select()
                .from(skills)
                .where(and(eq(skills.id, id), eq(skills.userId, userId)))
                .limit(1);
              return s;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!skill) {
            return yield* Effect.fail(new SkillNotFoundError(id));
          }

          const result = yield* Effect.tryPromise({
            try: async () => {
              const [updated] = await db
                .update(skills)
                .set({
                  enabled: !skill.enabled,
                  updatedAt: new Date(),
                })
                .where(and(eq(skills.id, id), eq(skills.userId, userId)))
                .returning();
              return updated;
            },
            catch: (error) => new DatabaseError(error),
          });

          return result!;
        }),

      import: (userId, input) =>
        Effect.tryPromise({
          try: async () => {
            await db.insert(skills).values({
              userId,
              name: input.name,
              tag: input.tag,
              description: input.description,
              prompt: input.prompt,
              enabled: input.enabled ?? true,
            });
            return await db.select().from(skills).where(forUser(userId)).orderBy(skills.createdAt);
          },
          catch: (error) => new DatabaseError(error),
        }),
    });
  })
);

// Test layer
export const SkillServiceTest = Layer.succeed(
  SkillService,
  SkillService.of({
    list: () => Effect.succeed([]),
    create: (_userId, input) =>
      Effect.succeed({
        id: 1,
        userId: _userId,
        name: input.name,
        tag: input.tag,
        description: input.description,
        prompt: input.prompt,
        enabled: input.enabled ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Skill),
    update: (_userId, id, input) =>
      Effect.succeed({
        id,
        userId: _userId,
        name: input.name,
        tag: input.tag,
        description: input.description,
        prompt: input.prompt,
        enabled: input.enabled ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Skill),
    delete: () => Effect.succeed(undefined),
    toggle: (_userId, id) =>
      Effect.succeed({
        id,
        userId: _userId,
        name: 'Test',
        tag: 'test',
        description: 'Test skill',
        prompt: 'Test prompt',
        enabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Skill),
    import: () => Effect.succeed([]),
  })
);

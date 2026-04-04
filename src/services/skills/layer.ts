import { eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { skills } from '../../infrastructure/db/schema';
import { DatabaseError, SkillNotFoundError } from '../../shared/errors';
import { DatabaseService } from '../database';
import { type SkillInput, SkillService } from './tag';

export const SkillServiceLive = Layer.effect(
  SkillService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    return SkillService.of({
      list: () =>
        Effect.tryPromise({
          try: async () => {
            return await db.select().from(skills).orderBy(skills.createdAt);
          },
          catch: (error) => new DatabaseError(error),
        }),

      create: (input) =>
        Effect.tryPromise({
          try: async () => {
            const [skill] = await db
              .insert(skills)
              .values({
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

      update: (id, input) =>
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
                .where(eq(skills.id, id))
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

      delete: (id) =>
        Effect.tryPromise({
          try: async () => {
            await db.delete(skills).where(eq(skills.id, id));
          },
          catch: (error) => new DatabaseError(error),
        }),

      toggle: (id) =>
        Effect.gen(function* () {
          const skill = yield* Effect.tryPromise({
            try: async () => {
              const [s] = await db.select().from(skills).where(eq(skills.id, id)).limit(1);
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
                .where(eq(skills.id, id))
                .returning();
              return updated;
            },
            catch: (error) => new DatabaseError(error),
          });

          return result!;
        }),

      import: (input) =>
        Effect.tryPromise({
          try: async () => {
            await db.insert(skills).values({
              name: input.name,
              tag: input.tag,
              description: input.description,
              prompt: input.prompt,
              enabled: input.enabled ?? true,
            });
            return await db.select().from(skills).orderBy(skills.createdAt);
          },
          catch: (error) => new DatabaseError(error),
        }),
    });
  })
);

// Layer para testing
export const SkillServiceTest = Layer.succeed(
  SkillService,
  SkillService.of({
    list: () => Effect.succeed([]),
    create: (input) =>
      Effect.succeed({
        id: 1,
        name: input.name,
        tag: input.tag,
        description: input.description,
        prompt: input.prompt,
        enabled: input.enabled ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    update: (id, input) =>
      Effect.succeed({
        id,
        name: input.name,
        tag: input.tag,
        description: input.description,
        prompt: input.prompt,
        enabled: input.enabled ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    delete: () => Effect.succeed(undefined),
    toggle: (id) =>
      Effect.succeed({
        id,
        name: 'Test',
        tag: 'test',
        description: 'Test skill',
        prompt: 'Test prompt',
        enabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    import: () => Effect.succeed([]),
  })
);

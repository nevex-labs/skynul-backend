import { createHash } from 'crypto';
import { and, desc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { projects } from '../../infrastructure/db/schema/projects';
import {
  type ObservationDto,
  type SaveObservationInput,
  type SearchObservationsOpts,
  type TaskMemoryDto,
  type UserFactDto,
  observations,
  taskLogs,
  userFacts,
  userLearnings,
} from '../../infrastructure/db/schema/task-memory';
import { DatabaseError } from '../../shared/errors';
import type { Database } from '../database/tag';
import { DatabaseService } from '../database/tag';
import { TaskMemoryService } from './tag';

const DEDUP_WINDOW_MS = 15 * 60 * 1000;

function hashNormalized(title: string, content: string): string {
  const normalized = `${title.trim().toLowerCase()}|${content.trim().toLowerCase()}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function toPlainTsQuery(query: string): string {
  return query.replace(/[^\w\s]/g, ' ').trim();
}

async function resolveProjectIdFromDb(
  db: Database,
  userId: number,
  projectName?: string,
  projectId?: number
): Promise<number | null> {
  if (projectId != null) return projectId;
  const name = projectName?.trim();
  if (!name) return null;
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.name, name)))
    .limit(1);
  return rows[0]?.id ?? null;
}

function toTaskMemoryDto(
  log: typeof taskLogs.$inferSelect,
  learnings: string
): TaskMemoryDto {
  return {
    prompt: log.prompt,
    outcome: log.outcome as 'completed' | 'failed',
    learnings,
  };
}

function toUserFactDto(row: typeof userFacts.$inferSelect): UserFactDto {
  return {
    id: row.id,
    fact: row.fact,
    createdAt: row.createdAt?.getTime() ?? Date.now(),
  };
}

function toObservationDto(row: typeof observations.$inferSelect): ObservationDto {
  return {
    id: row.id,
    taskId: row.taskId ?? undefined,
    type: row.type,
    title: row.title,
    content: row.content,
    projectId: row.projectId ?? undefined,
    scope: row.scope,
    topicKey: row.topicKey ?? undefined,
    normalizedHash: row.normalizedHash ?? undefined,
    revisionCount: row.revisionCount,
    duplicateCount: row.duplicateCount,
    lastSeenAt: row.lastSeenAt?.getTime() ?? undefined,
    createdAt: row.createdAt?.getTime() ?? Date.now(),
    updatedAt: row.updatedAt?.getTime() ?? Date.now(),
    deletedAt: row.deletedAt?.getTime() ?? undefined,
  };
}

export const TaskMemoryServiceLive = Layer.effect(
  TaskMemoryService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    return TaskMemoryService.of({
      saveMemory: (
        userId: number,
        entry: {
          taskId: string;
          prompt: string;
          outcome: 'completed' | 'failed';
          learnings: string;
          provider?: string;
          durationMs?: number;
        }
      ) =>
        Effect.gen(function* () {
          const logSearch = entry.prompt;
          const learningSearch = entry.learnings.trim();

          yield* Effect.tryPromise({
            try: async () => {
              await db
                .insert(taskLogs)
                .values({
                  userId,
                  taskId: entry.taskId,
                  prompt: entry.prompt,
                  outcome: entry.outcome,
                  searchVector: logSearch,
                  provider: entry.provider,
                  durationMs: entry.durationMs,
                })
                .onConflictDoUpdate({
                  target: taskLogs.taskId,
                  set: {
                    prompt: entry.prompt,
                    outcome: entry.outcome,
                    searchVector: logSearch,
                    provider: entry.provider,
                    durationMs: entry.durationMs,
                    createdAt: new Date(),
                  },
                });
            },
            catch: (error) => new DatabaseError(error),
          });

          yield* Effect.tryPromise({
            try: async () => {
              await db.delete(userLearnings).where(
                and(eq(userLearnings.userId, userId), eq(userLearnings.taskId, entry.taskId))
              );
              if (learningSearch) {
                await db.insert(userLearnings).values({
                  userId,
                  taskId: entry.taskId,
                  content: entry.learnings,
                  searchVector: learningSearch,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });
              }
            },
            catch: (error) => new DatabaseError(error),
          });
        }),

      searchMemories: (userId: number, query: string, limit = 3) =>
        Effect.gen(function* () {
          const tsQuery = toPlainTsQuery(query);
          if (!tsQuery) return [];

          return yield* Effect.tryPromise({
            try: async () => {
              const logRows = await db
                .select({
                  log: taskLogs,
                  rank: sql<number>`
                    ts_rank_cd(to_tsvector('english', ${taskLogs.searchVector}), plainto_tsquery('english', ${tsQuery})) *
                    (1.0 + (EXTRACT(EPOCH FROM NOW() - ${taskLogs.createdAt}) / 2592000.0) * -0.1)
                  `.as('rank'),
                })
                .from(taskLogs)
                .where(
                  and(
                    eq(taskLogs.userId, userId),
                    sql`to_tsvector('english', ${taskLogs.searchVector}) @@ plainto_tsquery('english', ${tsQuery})`
                  )
                )
                .orderBy(desc(sql`rank`))
                .limit(limit);

              const learnRows = await db
                .select({
                  learning: userLearnings,
                  log: taskLogs,
                  rank: sql<number>`
                    ts_rank_cd(to_tsvector('english', ${userLearnings.searchVector}), plainto_tsquery('english', ${tsQuery})) *
                    (1.0 + (EXTRACT(EPOCH FROM NOW() - ${userLearnings.createdAt}) / 2592000.0) * -0.1)
                  `.as('rank'),
                })
                .from(userLearnings)
                .innerJoin(taskLogs, eq(taskLogs.taskId, userLearnings.taskId))
                .where(
                  and(
                    eq(userLearnings.userId, userId),
                    eq(taskLogs.userId, userId),
                    isNotNull(userLearnings.taskId),
                    sql`to_tsvector('english', ${userLearnings.searchVector}) @@ plainto_tsquery('english', ${tsQuery})`
                  )
                )
                .orderBy(desc(sql`rank`))
                .limit(limit);

              const byTask = new Map<string, { log: typeof taskLogs.$inferSelect; learnings: string; rank: number }>();

              for (const r of logRows) {
                const [ul] = await db
                  .select()
                  .from(userLearnings)
                  .where(and(eq(userLearnings.userId, userId), eq(userLearnings.taskId, r.log.taskId)))
                  .limit(1);
                const learnings = ul?.content ?? '';
                const prev = byTask.get(r.log.taskId);
                const rank = r.rank ?? 0;
                if (!prev || rank > prev.rank) {
                  byTask.set(r.log.taskId, { log: r.log, learnings, rank });
                }
              }

              for (const r of learnRows) {
                const rank = r.rank ?? 0;
                const prev = byTask.get(r.log.taskId);
                if (!prev || rank > prev.rank) {
                  byTask.set(r.log.taskId, { log: r.log, learnings: r.learning.content, rank });
                }
              }

              return Array.from(byTask.values())
                .sort((a, b) => b.rank - a.rank)
                .slice(0, limit)
                .map((x) => toTaskMemoryDto(x.log, x.learnings));
            },
            catch: (error) => new DatabaseError(error),
          });
        }),

      formatMemoriesForPrompt: (memories: TaskMemoryDto[]): string => {
        if (memories.length === 0) return '';
        const lines = memories.map((m, i) => {
          const status = m.outcome === 'completed' ? 'SUCCESS' : 'FAILED';
          return `[Memory ${i + 1}] (${status}) Task: "${m.prompt}"\n${m.learnings}`;
        });
        return `\n## Past experience (use working selectors and avoid failed strategies):\n${lines.join('\n\n')}\n`;
      },

      saveFact: (userId: number, fact: string) =>
        Effect.gen(function* () {
          const trimmed = fact.trim();
          if (!trimmed) return;

          const existingFacts = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select({ id: userFacts.id, fact: userFacts.fact })
                .from(userFacts)
                .where(eq(userFacts.userId, userId));
            },
            catch: (error) => new DatabaseError(error),
          });

          const lower = trimmed.toLowerCase();
          for (const e of existingFacts) {
            const eLower = e.fact.toLowerCase();
            if (eLower === lower || eLower.includes(lower) || lower.includes(eLower)) {
              yield* Effect.tryPromise({
                try: async () => {
                  await db
                    .update(userFacts)
                    .set({
                      fact: trimmed,
                      searchVector: trimmed,
                      createdAt: new Date(),
                    })
                    .where(and(eq(userFacts.id, e.id), eq(userFacts.userId, userId)));
                },
                catch: (error) => new DatabaseError(error),
              });
              return;
            }
          }

          yield* Effect.tryPromise({
            try: async () => {
              await db.insert(userFacts).values({
                userId,
                fact: trimmed,
                searchVector: trimmed,
              });
            },
            catch: (error) => new DatabaseError(error),
          });
        }),

      deleteFact: (userId: number, id: number) =>
        Effect.tryPromise({
          try: async () => {
            await db.delete(userFacts).where(and(eq(userFacts.id, id), eq(userFacts.userId, userId)));
          },
          catch: (error) => new DatabaseError(error),
        }),

      listFacts: (userId: number) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await db
              .select()
              .from(userFacts)
              .where(eq(userFacts.userId, userId))
              .orderBy(desc(userFacts.createdAt));
            return rows.map(toUserFactDto);
          },
          catch: (error) => new DatabaseError(error),
        }),

      searchFacts: (userId: number, query: string, limit = 5) =>
        Effect.gen(function* () {
          const allFacts = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select({ count: sql<number>`count(*)` })
                .from(userFacts)
                .where(eq(userFacts.userId, userId));
            },
            catch: (error) => new DatabaseError(error),
          });

          const totalCount = allFacts[0]?.count ?? 0;

          if (totalCount <= 20) {
            const all = yield* Effect.tryPromise({
              try: async () => {
                return await db
                  .select({ fact: userFacts.fact })
                  .from(userFacts)
                  .where(eq(userFacts.userId, userId))
                  .orderBy(desc(userFacts.createdAt));
              },
              catch: (error) => new DatabaseError(error),
            });
            return all.map((r) => r.fact);
          }

          const tsQuery = toPlainTsQuery(query);
          if (!tsQuery) return [];

          const rows = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select({ fact: userFacts.fact })
                .from(userFacts)
                .where(
                  and(
                    eq(userFacts.userId, userId),
                    sql`to_tsvector('english', ${userFacts.searchVector}) @@ plainto_tsquery('english', ${tsQuery})`
                  )
                )
                .orderBy(
                  desc(
                    sql`ts_rank_cd(to_tsvector('english', ${userFacts.searchVector}), plainto_tsquery('english', ${tsQuery}))`
                  )
                )
                .limit(limit);
            },
            catch: (error) => new DatabaseError(error),
          });

          return rows.map((r) => r.fact);
        }),

      formatFactsForPrompt: (facts: string[]): string => {
        if (facts.length === 0) return '';
        return `\n## Your memory (facts you know about the user and environment):\n${facts.map((f) => `- ${f}`).join('\n')}\n`;
      },

      saveObservation: (userId: number, input: SaveObservationInput) =>
        Effect.gen(function* () {
          const now = new Date();
          const type = input.obsType ?? 'manual';
          const scope = input.scope ?? 'project';
          const hash = hashNormalized(input.title, input.content);
          const projectIdResolved = yield* Effect.tryPromise({
            try: () => resolveProjectIdFromDb(db, userId, input.project, input.projectId),
            catch: (error) => new DatabaseError(error),
          });

          if (input.topicKey) {
            const existing = yield* Effect.tryPromise({
              try: async () => {
                return await db
                  .select({ id: observations.id, revisionCount: observations.revisionCount })
                  .from(observations)
                  .where(
                    and(
                      eq(observations.userId, userId),
                      eq(observations.topicKey, input.topicKey as string),
                      isNull(observations.deletedAt)
                    )
                  )
                  .limit(1);
              },
              catch: (error) => new DatabaseError(error),
            });

            if (existing.length > 0) {
              const obs = existing[0];
              yield* Effect.tryPromise({
                try: async () => {
                  await db
                    .update(observations)
                    .set({
                      title: input.title,
                      content: input.content,
                      type,
                      projectId: projectIdResolved,
                      scope,
                      normalizedHash: hash,
                      searchVector: `${input.title} ${input.content}`,
                      revisionCount: obs.revisionCount + 1,
                      updatedAt: now,
                    })
                    .where(and(eq(observations.id, obs.id), eq(observations.userId, userId)));
                },
                catch: (error) => new DatabaseError(error),
              });
              return obs.id;
            }
          }

          const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
          const dup = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .select({ id: observations.id, duplicateCount: observations.duplicateCount })
                .from(observations)
                .where(
                  and(
                    eq(observations.userId, userId),
                    eq(observations.normalizedHash, hash),
                    gt(observations.createdAt, cutoff),
                    isNull(observations.deletedAt)
                  )
                )
                .limit(1);
            },
            catch: (error) => new DatabaseError(error),
          });

          if (dup.length > 0) {
            const existingDup = dup[0];
            yield* Effect.tryPromise({
              try: async () => {
                await db
                  .update(observations)
                  .set({
                    duplicateCount: existingDup.duplicateCount + 1,
                    lastSeenAt: now,
                    updatedAt: now,
                  })
                  .where(and(eq(observations.id, existingDup.id), eq(observations.userId, userId)));
              },
              catch: (error) => new DatabaseError(error),
            });
            return existingDup.id;
          }

          const result = yield* Effect.tryPromise({
            try: async () => {
              const rows = await db
                .insert(observations)
                .values({
                  userId,
                  taskId: input.taskId ?? null,
                  type,
                  title: input.title,
                  content: input.content,
                  projectId: projectIdResolved,
                  scope,
                  topicKey: input.topicKey ?? null,
                  normalizedHash: hash,
                  searchVector: `${input.title} ${input.content}`,
                  revisionCount: 1,
                  duplicateCount: 1,
                  lastSeenAt: now,
                  createdAt: now,
                  updatedAt: now,
                })
                .returning({ id: observations.id });
              return rows[0];
            },
            catch: (error) => new DatabaseError(error),
          });

          return result.id;
        }),

      searchObservations: (userId: number, query: string, opts: SearchObservationsOpts = {}) =>
        Effect.gen(function* () {
          const tsQuery = toPlainTsQuery(query);
          if (!tsQuery) return [];

          const projectFilterId = yield* Effect.tryPromise({
            try: () => resolveProjectIdFromDb(db, userId, opts.project, opts.projectId ?? undefined),
            catch: (error) => new DatabaseError(error),
          });

          const rows = yield* Effect.tryPromise({
            try: async () => {
              const conditions = [
                eq(observations.userId, userId),
                isNull(observations.deletedAt),
                sql`to_tsvector('english', ${observations.searchVector}) @@ plainto_tsquery('english', ${tsQuery})`,
              ];

              if (opts.typeFilter) {
                conditions.push(eq(observations.type, opts.typeFilter));
              }
              if (projectFilterId != null) {
                conditions.push(eq(observations.projectId, projectFilterId));
              }

              return await db
                .select({
                  id: observations.id,
                  userId: observations.userId,
                  taskId: observations.taskId,
                  type: observations.type,
                  title: observations.title,
                  content: observations.content,
                  projectId: observations.projectId,
                  scope: observations.scope,
                  topicKey: observations.topicKey,
                  normalizedHash: observations.normalizedHash,
                  revisionCount: observations.revisionCount,
                  duplicateCount: observations.duplicateCount,
                  lastSeenAt: observations.lastSeenAt,
                  createdAt: observations.createdAt,
                  updatedAt: observations.updatedAt,
                  deletedAt: observations.deletedAt,
                  rank: sql<number>`
                    ts_rank_cd(to_tsvector('english', ${observations.searchVector}), plainto_tsquery('english', ${tsQuery}))
                  `.as('rank'),
                })
                .from(observations)
                .where(and(...conditions))
                .orderBy(desc(sql`rank`))
                .limit(opts.limit ?? 10);
            },
            catch: (error) => new DatabaseError(error),
          });

          return rows.map((row) => ({
            id: row.id,
            taskId: row.taskId ?? undefined,
            type: row.type,
            title: row.title,
            content: row.content,
            projectId: row.projectId ?? undefined,
            scope: row.scope,
            topicKey: row.topicKey ?? undefined,
            normalizedHash: row.normalizedHash ?? undefined,
            revisionCount: row.revisionCount,
            duplicateCount: row.duplicateCount,
            lastSeenAt: row.lastSeenAt?.getTime() ?? undefined,
            createdAt: row.createdAt?.getTime() ?? Date.now(),
            updatedAt: row.updatedAt?.getTime() ?? Date.now(),
            deletedAt: row.deletedAt?.getTime() ?? undefined,
          }));
        }),

      getRecentObservations: (userId: number, opts: SearchObservationsOpts = {}) =>
        Effect.gen(function* () {
          const projectFilterId = yield* Effect.tryPromise({
            try: () => resolveProjectIdFromDb(db, userId, opts.project, opts.projectId ?? undefined),
            catch: (error) => new DatabaseError(error),
          });

          return yield* Effect.tryPromise({
            try: async () => {
              const conditions = [eq(observations.userId, userId), isNull(observations.deletedAt)];

              if (opts.typeFilter) {
                conditions.push(eq(observations.type, opts.typeFilter));
              }
              if (projectFilterId != null) {
                conditions.push(eq(observations.projectId, projectFilterId));
              }

              const rows = await db
                .select()
                .from(observations)
                .where(and(...conditions))
                .orderBy(desc(observations.updatedAt), desc(observations.id))
                .limit(opts.limit ?? 20);

              return rows.map(toObservationDto);
            },
            catch: (error) => new DatabaseError(error),
          });
        }),

      deleteObservation: (userId: number, id: number) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(observations)
              .set({ deletedAt: new Date() })
              .where(and(eq(observations.id, id), eq(observations.userId, userId)));
          },
          catch: (error) => new DatabaseError(error),
        }),

      formatObservationsForPrompt: (obs: ObservationDto[]): string => {
        if (obs.length === 0) return '';
        const lines = obs.map((o) => {
          const meta = [o.type, o.topicKey ? `key:${o.topicKey}` : null, o.projectId ? `project:#${o.projectId}` : null]
            .filter(Boolean)
            .join(', ');
          return `[${meta}] **${o.title}**: ${o.content}`;
        });
        return `\n## Knowledge memory:\n${lines.join('\n')}\n`;
      },
    });
  })
);

export const TaskMemoryServiceTest = Layer.succeed(
  TaskMemoryService,
  TaskMemoryService.of({
    saveMemory: () => Effect.succeed(undefined),
    searchMemories: () => Effect.succeed([]),
    formatMemoriesForPrompt: () => '',
    saveFact: () => Effect.succeed(undefined),
    deleteFact: () => Effect.succeed(undefined),
    listFacts: () => Effect.succeed([]),
    searchFacts: () => Effect.succeed([]),
    formatFactsForPrompt: () => '',
    saveObservation: () => Effect.succeed(-1),
    searchObservations: () => Effect.succeed([]),
    getRecentObservations: () => Effect.succeed([]),
    deleteObservation: () => Effect.succeed(undefined),
    formatObservationsForPrompt: () => '',
  })
);

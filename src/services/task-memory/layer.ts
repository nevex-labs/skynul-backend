import { createHash } from 'crypto';
import { and, desc, eq, gt, isNull, like, or, sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import {
  type ObservationDto,
  type SaveObservationInput,
  type SearchObservationsOpts,
  type TaskMemoryDto,
  type UserFactDto,
  observations,
  taskMemories,
  userFacts,
} from '../../infrastructure/db/schema/task-memory';
import { DatabaseError } from '../../shared/errors';
import { DatabaseService } from '../database/tag';
import { TaskMemoryService } from './tag';

// ── Internal helpers ──────────────────────────────────────────────────────────

const DEDUP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** SHA-256 hash of lowercased, trimmed title+content (for dedup). */
function hashNormalized(title: string, content: string): string {
  const normalized = `${title.trim().toLowerCase()}|${content.trim().toLowerCase()}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/** Convert query string to PostgreSQL tsquery format */
function toTsQuery(query: string): string {
  // Split into words, filter short words, and join with & for AND semantics
  const words = query
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (words.length === 0) return '';
  return words.map((w) => w.toLowerCase()).join(' & ');
}

/** Convert query string to PostgreSQL plainto_tsquery format */
function toPlainTsQuery(query: string): string {
  // For plainto_tsquery - just clean the input
  return query.replace(/[^\w\s]/g, ' ').trim();
}

function toTaskMemoryDto(row: typeof taskMemories.$inferSelect): TaskMemoryDto {
  return {
    prompt: row.prompt,
    outcome: row.outcome as 'completed' | 'failed',
    learnings: row.learnings,
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
    project: row.project ?? undefined,
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

// ── Layer Implementation ─────────────────────────────────────────────────────

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
          // Build search vector from prompt and learnings
          const searchVector = `${entry.prompt} ${entry.learnings}`;

          yield* Effect.tryPromise({
            try: async () => {
              await db
                .insert(taskMemories)
                .values({
                  userId,
                  taskId: entry.taskId,
                  prompt: entry.prompt,
                  outcome: entry.outcome,
                  learnings: entry.learnings,
                  provider: entry.provider,
                  durationMs: entry.durationMs,
                  searchVector,
                })
                .onConflictDoUpdate({
                  target: taskMemories.taskId,
                  set: {
                    prompt: entry.prompt,
                    outcome: entry.outcome,
                    learnings: entry.learnings,
                    provider: entry.provider,
                    durationMs: entry.durationMs,
                    searchVector,
                    createdAt: new Date(),
                  },
                });
            },
            catch: (error) => new DatabaseError(error),
          });
        }),

      searchMemories: (userId: number, query: string, limit = 3) =>
        Effect.gen(function* () {
          const tsQuery = toPlainTsQuery(query);
          if (!tsQuery) return [];

          const rows = yield* Effect.tryPromise({
            try: async () => {
              // Use PostgreSQL full-text search with ts_rank_cd for relevance
              // Combined with recency scoring: newer entries get boosted
              return await db
                .select({
                  id: taskMemories.id,
                  prompt: taskMemories.prompt,
                  outcome: taskMemories.outcome,
                  learnings: taskMemories.learnings,
                  createdAt: taskMemories.createdAt,
                  // Calculate rank combining relevance and recency
                  rank: sql<number>`
                    ts_rank_cd(to_tsvector('english', ${taskMemories.searchVector}), plainto_tsquery('english', ${tsQuery})) *
                    (1.0 + (EXTRACT(EPOCH FROM NOW() - ${taskMemories.createdAt}) / 2592000.0) * -0.1)
                  `.as('rank'),
                })
                .from(taskMemories)
                .where(
                  and(
                    eq(taskMemories.userId, userId),
                    sql`to_tsvector('english', ${taskMemories.searchVector}) @@ plainto_tsquery('english', ${tsQuery})`
                  )
                )
                .orderBy(desc(sql`rank`))
                .limit(limit);
            },
            catch: (error) => new DatabaseError(error),
          });

          return rows.map((row) => ({
            prompt: row.prompt,
            outcome: row.outcome as 'completed' | 'failed',
            learnings: row.learnings,
          }));
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

          // Check for existing similar fact
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
            // Exact or near-duplicate — update instead of inserting
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

          // Insert new fact
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
          // First get all facts count
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

          // If few facts, return all
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

          // Many facts → FTS search
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

          // 1. topic_key upsert
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
                      project: input.project ?? null,
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

          // 2. Hash dedup within 15-minute window
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
            const existing = dup[0];
            yield* Effect.tryPromise({
              try: async () => {
                await db
                  .update(observations)
                  .set({
                    duplicateCount: existing.duplicateCount + 1,
                    lastSeenAt: now,
                    updatedAt: now,
                  })
                  .where(and(eq(observations.id, existing.id), eq(observations.userId, userId)));
              },
              catch: (error) => new DatabaseError(error),
            });
            return existing.id;
          }

          // 3. Insert new observation
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
                  project: input.project ?? null,
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

          const rows = yield* Effect.tryPromise({
            try: async () => {
              // Build conditions array
              const conditions = [
                eq(observations.userId, userId),
                isNull(observations.deletedAt),
                sql`to_tsvector('english', ${observations.searchVector}) @@ plainto_tsquery('english', ${tsQuery})`,
              ];

              if (opts.typeFilter) {
                conditions.push(eq(observations.type, opts.typeFilter));
              }
              if (opts.project) {
                conditions.push(eq(observations.project, opts.project));
              }

              return await db
                .select({
                  id: observations.id,
                  userId: observations.userId,
                  taskId: observations.taskId,
                  type: observations.type,
                  title: observations.title,
                  content: observations.content,
                  project: observations.project,
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
            project: row.project ?? undefined,
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
        Effect.tryPromise({
          try: async () => {
            // Build conditions array
            const conditions = [eq(observations.userId, userId), isNull(observations.deletedAt)];

            if (opts.typeFilter) {
              conditions.push(eq(observations.type, opts.typeFilter));
            }
            if (opts.project) {
              conditions.push(eq(observations.project, opts.project));
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
          const meta = [o.type, o.topicKey ? `key:${o.topicKey}` : null].filter(Boolean).join(', ');
          return `[${meta}] **${o.title}**: ${o.content}`;
        });
        return `\n## Knowledge memory:\n${lines.join('\n')}\n`;
      },
    });
  })
);

// Layer para testing
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

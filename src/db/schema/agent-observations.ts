import { bigint, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { tasksTable } from './tasks';
import { usersTable } from './users';

export const agentObservationsTable = pgTable(
  'agent_observations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasksTable.id, { onDelete: 'set null' }),

    type: text('type').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    project: text('project'),
    scope: text('scope').notNull(),
    topicKey: text('topic_key'),
    normalizedHash: text('normalized_hash'),

    revisionCount: integer('revision_count').notNull().default(1),
    duplicateCount: integer('duplicate_count').notNull().default(1),

    lastSeenAt: bigint('last_seen_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    deletedAt: bigint('deleted_at', { mode: 'number' }),
  },
  (t) => [index('agent_observations_user_idx').on(t.userId)]
);

export type AgentObservation = typeof agentObservationsTable.$inferSelect;
export type NewAgentObservation = typeof agentObservationsTable.$inferInsert;

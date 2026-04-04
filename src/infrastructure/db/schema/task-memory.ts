import { sql } from 'drizzle-orm';
import { index, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Task Memory - Stores task execution history with full-text search.
 * Migrated from SQLite FTS5 to PostgreSQL tsvector.
 */

export const taskMemories = pgTable(
  'task_memories',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: varchar('task_id', { length: 255 }).notNull().unique(),
    prompt: text('prompt').notNull(),
    outcome: varchar('outcome', { length: 20 }).notNull(), // 'completed' | 'failed'
    learnings: text('learnings').notNull(),
    provider: varchar('provider', { length: 50 }),
    durationMs: integer('duration_ms'),
    // Full-text search vector - will be created via migration with generated column
    searchVector: text('search_vector'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    // GIN index for fast full-text search
    searchVectorIdx: index('task_memories_search_vector_idx').using(
      'gin',
      sql`to_tsvector('english', ${table.searchVector})`
    ),
    userIdIdx: index('task_memories_user_id_idx').on(table.userId),
    taskIdIdx: index('task_memories_task_id_idx').on(table.taskId),
    createdAtIdx: index('task_memories_created_at_idx').on(table.createdAt),
  })
);

export const userFacts = pgTable(
  'user_facts',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fact: text('fact').notNull(),
    // Full-text search vector - will be created via migration with generated column
    searchVector: text('search_vector'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    // GIN index for fast full-text search
    searchVectorIdx: index('user_facts_search_vector_idx').using(
      'gin',
      sql`to_tsvector('english', ${table.searchVector})`
    ),
    userIdIdx: index('user_facts_user_id_idx').on(table.userId),
    createdAtIdx: index('user_facts_created_at_idx').on(table.createdAt),
  })
);

export const observations = pgTable(
  'observations',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: varchar('task_id', { length: 255 }),
    type: varchar('type', { length: 50 }).notNull().default('manual'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    project: varchar('project', { length: 100 }),
    scope: varchar('scope', { length: 20 }).notNull().default('project'), // 'project' | 'personal'
    topicKey: varchar('topic_key', { length: 255 }),
    normalizedHash: varchar('normalized_hash', { length: 32 }),
    revisionCount: integer('revision_count').notNull().default(1),
    duplicateCount: integer('duplicate_count').notNull().default(1),
    lastSeenAt: timestamp('last_seen_at'),
    // Full-text search vector - will be created via migration with generated column
    searchVector: text('search_vector'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'), // Soft delete
  },
  (table) => ({
    // GIN index for fast full-text search
    searchVectorIdx: index('observations_search_vector_idx').using(
      'gin',
      sql`to_tsvector('english', ${table.searchVector})`
    ),
    userIdIdx: index('observations_user_id_idx').on(table.userId),
    topicKeyIdx: index('observations_topic_key_idx').on(table.topicKey),
    projectIdx: index('observations_project_idx').on(table.project),
    typeIdx: index('observations_type_idx').on(table.type),
    hashIdx: index('observations_hash_idx').on(table.normalizedHash),
    updatedAtIdx: index('observations_updated_at_idx').on(table.updatedAt),
    deletedAtIdx: index('observations_deleted_at_idx').on(table.deletedAt),
  })
);

// Types
export type TaskMemory = typeof taskMemories.$inferSelect;
export type NewTaskMemory = typeof taskMemories.$inferInsert;
export type UserFact = typeof userFacts.$inferSelect;
export type NewUserFact = typeof userFacts.$inferInsert;
export type Observation = typeof observations.$inferSelect;
export type NewObservation = typeof observations.$inferInsert;

// DTOs for service layer
export type TaskMemoryDto = {
  prompt: string;
  outcome: 'completed' | 'failed';
  learnings: string;
};

export type UserFactDto = {
  id: number;
  fact: string;
  createdAt: number;
};

export type ObservationDto = {
  id: number;
  taskId?: string;
  type: string;
  title: string;
  content: string;
  project?: string;
  scope: string;
  topicKey?: string;
  normalizedHash?: string;
  revisionCount: number;
  duplicateCount: number;
  lastSeenAt?: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type SaveObservationInput = {
  title: string;
  content: string;
  taskId?: string;
  obsType?: string;
  project?: string;
  scope?: string;
  topicKey?: string;
};

export type SearchObservationsOpts = {
  typeFilter?: string;
  project?: string;
  limit?: number;
};

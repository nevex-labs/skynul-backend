import { sql } from 'drizzle-orm';
import { index, integer, pgTable, real, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { users } from './users';

export const taskLogs = pgTable(
  'task_logs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: varchar('task_id', { length: 255 }).notNull().unique(),
    prompt: text('prompt').notNull(),
    outcome: varchar('outcome', { length: 20 }).notNull(),
    searchVector: text('search_vector'),
    provider: varchar('provider', { length: 50 }),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    searchVectorIdx: index('task_logs_search_vector_idx').using(
      'gin',
      sql`to_tsvector('english', ${table.searchVector})`
    ),
    userIdIdx: index('task_logs_user_id_idx').on(table.userId),
    taskIdIdx: index('task_logs_task_id_idx').on(table.taskId),
    createdAtIdx: index('task_logs_created_at_idx').on(table.createdAt),
  })
);

export const userLearnings = pgTable(
  'user_learnings',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: varchar('task_id', { length: 255 }),
    content: text('content').notNull(),
    category: varchar('category', { length: 100 }),
    relevanceScore: real('relevance_score').notNull().default(1.0),
    timesApplied: integer('times_applied').notNull().default(0),
    searchVector: text('search_vector'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    searchVectorIdx: index('user_learnings_search_vector_idx').using(
      'gin',
      sql`to_tsvector('english', ${table.searchVector})`
    ),
    userIdIdx: index('user_learnings_user_id_idx').on(table.userId),
    taskIdIdx: index('user_learnings_task_id_idx').on(table.taskId),
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
    searchVector: text('search_vector'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
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
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    scope: varchar('scope', { length: 20 }).notNull().default('project'),
    topicKey: varchar('topic_key', { length: 255 }),
    normalizedHash: varchar('normalized_hash', { length: 32 }),
    revisionCount: integer('revision_count').notNull().default(1),
    duplicateCount: integer('duplicate_count').notNull().default(1),
    lastSeenAt: timestamp('last_seen_at'),
    searchVector: text('search_vector'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    searchVectorIdx: index('observations_search_vector_idx').using(
      'gin',
      sql`to_tsvector('english', ${table.searchVector})`
    ),
    userIdIdx: index('observations_user_id_idx').on(table.userId),
    topicKeyIdx: index('observations_topic_key_idx').on(table.topicKey),
    projectIdIdx: index('observations_project_id_idx').on(table.projectId),
    typeIdx: index('observations_type_idx').on(table.type),
    hashIdx: index('observations_hash_idx').on(table.normalizedHash),
    updatedAtIdx: index('observations_updated_at_idx').on(table.updatedAt),
    deletedAtIdx: index('observations_deleted_at_idx').on(table.deletedAt),
  })
);

export type TaskLog = typeof taskLogs.$inferSelect;
export type NewTaskLog = typeof taskLogs.$inferInsert;
export type UserLearning = typeof userLearnings.$inferSelect;
export type NewUserLearning = typeof userLearnings.$inferInsert;
export type UserFact = typeof userFacts.$inferSelect;
export type NewUserFact = typeof userFacts.$inferInsert;
export type Observation = typeof observations.$inferSelect;
export type NewObservation = typeof observations.$inferInsert;

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
  projectId?: number;
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
  projectId?: number;
  scope?: string;
  topicKey?: string;
};

export type SearchObservationsOpts = {
  typeFilter?: string;
  project?: string;
  projectId?: number;
  limit?: number;
};

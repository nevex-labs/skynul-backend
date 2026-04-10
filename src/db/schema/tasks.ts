import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { bigint, boolean, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { usersTable } from './users';

export type TaskStatus =
  | 'pending_approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'monitoring';

export type TaskMode = 'web' | 'sandbox';

export type OrchestrateType = 'single' | 'sequential' | 'parallel' | 'conditional';

export type TaskCapability =
  | 'browser.cdp'
  | 'app.launch'
  | 'app.scripting'
  | 'polymarket.trading'
  | 'onchain.trading'
  | 'cex.trading'
  | 'office.professional';

export type OrchestratorPlan = {
  objective: string;
  constraints: string[];
  subtasks: Array<{
    id: string;
    prompt: string;
    role: string;
    mode?: TaskMode;
    capabilities?: TaskCapability[];
    dependsOn?: string[];
  }>;
  successCriteria: string[];
  failureCriteria: string[];
  risks: string[];
};

export const tasksTable = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => tasksTable.id, { onDelete: 'set null' }),

    status: text('status').notNull(),
    mode: text('mode').notNull(),
    orchestrate: text('orchestrate').default('single').notNull(),
    capabilities: text('capabilities').array().notNull().default([]),

    prompt: text('prompt').notNull(),
    attachments: text('attachments').array(),

    plan: jsonb('plan').$type<OrchestratorPlan | null>(),

    agentName: text('agent_name'),
    agentRole: text('agent_role'),
    skipMemory: boolean('skip_memory').default(false),

    usageInputTokens: integer('usage_input_tokens'),
    usageOutputTokens: integer('usage_output_tokens'),
    summary: text('summary'),
    error: text('error'),

    maxSteps: integer('max_steps').notNull(),
    timeoutMs: integer('timeout_ms').notNull(),

    source: text('source'),
    model: text('model'),

    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('tasks_user_idx').on(t.userId),
    index('tasks_parent_idx').on(t.parentTaskId),
    index('tasks_status_idx').on(t.status),
  ]
);

export type Task = typeof tasksTable.$inferSelect;
export type NewTask = typeof tasksTable.$inferInsert;

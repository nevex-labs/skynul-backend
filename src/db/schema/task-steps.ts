import { bigint, integer, jsonb, pgTable, real, text, uuid } from 'drizzle-orm/pg-core';
import { tasksTable } from './tasks';

export const taskStepsTable = pgTable('task_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasksTable.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
  actionType: text('action_type').notNull(),
  action: jsonb('action').notNull(),
  screenshotBase64: text('screenshot_base64'),
  contextPct: real('context_pct'),
  contextTokens: jsonb('context_tokens'),
  error: text('error'),
});

export type TaskStep = typeof taskStepsTable.$inferSelect;
export type NewTaskStep = typeof taskStepsTable.$inferInsert;

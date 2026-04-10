import { boolean, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { tasksTable } from './tasks';

export const taskMonitorsTable = pgTable('task_monitors', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasksTable.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  active: boolean('active').notNull().default(true),
  intervalMs: integer('interval_ms'),
  lastCheck: integer('last_check'),
  lastResult: text('last_result'),
});

export type TaskMonitor = typeof taskMonitorsTable.$inferSelect;
export type NewTaskMonitor = typeof taskMonitorsTable.$inferInsert;

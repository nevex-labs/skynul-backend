import { bigint, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { tasksTable } from './tasks';
import { usersTable } from './users';

export const taskMemoriesTable = pgTable(
  'task_memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasksTable.id, { onDelete: 'cascade' }),

    prompt: text('prompt').notNull(),
    outcome: text('outcome').notNull(),
    learnings: text('learnings').notNull(),

    provider: text('provider'),
    durationMs: integer('duration_ms'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [unique('task_memories_user_task').on(t.userId, t.taskId), index('task_memories_user_idx').on(t.userId)]
);

export type TaskMemory = typeof taskMemoriesTable.$inferSelect;
export type NewTaskMemory = typeof taskMemoriesTable.$inferInsert;

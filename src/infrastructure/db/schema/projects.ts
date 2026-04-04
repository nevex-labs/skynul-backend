import { integer, pgTable, primaryKey, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  color: varchar('color', { length: 7 }).notNull().default('#6366f1'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const projectTasks = pgTable(
  'project_tasks',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: varchar('task_id', { length: 255 }).notNull(),
    addedAt: timestamp('added_at').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.taskId] }),
  })
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectTask = typeof projectTasks.$inferSelect;
export type NewProjectTask = typeof projectTasks.$inferInsert;

export type ProjectWithTasks = Project & {
  taskIds: string[];
};

import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { usersTable } from './users';

export const skillsTable = pgTable(
  'skills',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_skills_user').on(t.userId)]
);

export type Skill = typeof skillsTable.$inferSelect;
export type NewSkill = typeof skillsTable.$inferInsert;

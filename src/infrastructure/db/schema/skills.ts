import { boolean, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const skills = pgTable('skills', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  tag: varchar('tag', { length: 100 }).notNull(),
  description: text('description').notNull(),
  prompt: text('prompt').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;

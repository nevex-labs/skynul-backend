import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { usersTable } from './users';

export const secretsTable = pgTable(
  'secrets',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('uniq_secret').on(t.userId, t.type, t.provider), index('idx_secrets_user').on(t.userId)]
);

export type Secret = typeof secretsTable.$inferSelect;
export type NewSecret = typeof secretsTable.$inferInsert;

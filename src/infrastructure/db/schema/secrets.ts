import { integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

export const secrets = pgTable(
  'secrets',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    keyName: varchar('key_name', { length: 255 }).notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    uniqueUserKey: uniqueIndex('unique_user_key').on(table.userId, table.keyName),
  })
);

export type Secret = typeof secrets.$inferSelect;
export type NewSecret = typeof secrets.$inferInsert;

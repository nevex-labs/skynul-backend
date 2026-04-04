import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

export const APP_SECRET_NAMESPACE = 'app' as const;
export const PROVIDER_SECRET_NAMESPACE = 'provider' as const;

export const secrets = pgTable(
  'secrets',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    namespace: varchar('namespace', { length: 50 }).notNull(),
    keyName: varchar('key_name', { length: 255 }).notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    uniqueUserNamespaceKey: uniqueIndex('secrets_user_namespace_key_unique').on(
      table.userId,
      table.namespace,
      table.keyName
    ),
  })
);

export type Secret = typeof secrets.$inferSelect;
export type NewSecret = typeof secrets.$inferInsert;

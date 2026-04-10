import { jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const usersTable = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    walletAddress: text('wallet_address').notNull(),
    chain: text('chain').notNull(),
    displayName: text('display_name'),
    settings: jsonb('settings').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('uniq_wallet').on(t.walletAddress, t.chain)]
);

export type User = typeof usersTable.$inferSelect;
export type NewUser = typeof usersTable.$inferInsert;

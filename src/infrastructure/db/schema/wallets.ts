import { boolean, integer, pgEnum, pgTable, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

export const chainEnum = pgEnum('chain', ['evm', 'solana', 'bitcoin']);

export const wallets = pgTable(
  'wallets',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    address: varchar('address', { length: 255 }).notNull(),
    chain: chainEnum('chain').notNull(),
    isPrimary: boolean('is_primary').notNull().default(true),
    lastSignedAt: timestamp('last_signed_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => [unique('wallets_address_chain_unique').on(t.address, t.chain)]
);

export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;

import { integer, pgTable, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

export const allowances = pgTable(
  'allowances',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenAddress: varchar('token_address', { length: 255 }).notNull(),
    chainId: integer('chain_id').notNull(),
    approvedAmount: varchar('approved_amount', { length: 78 }).notNull().default('0'),
    usedAmount: varchar('used_amount', { length: 78 }).notNull().default('0'),
    feeCollected: varchar('fee_collected', { length: 78 }).notNull().default('0'),
    lastSyncAt: timestamp('last_sync_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [unique('allowances_user_token_chain_unique').on(t.userId, t.tokenAddress, t.chainId)]
);

export type Allowance = typeof allowances.$inferSelect;
export type NewAllowance = typeof allowances.$inferInsert;

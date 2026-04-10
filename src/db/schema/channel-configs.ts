import { index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { usersTable } from './users';

export const channelConfigsTable = pgTable(
  'channel_configs',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    channelKey: text('channel_key').notNull(),
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('channel_configs_user_key').on(t.userId, t.channelKey), index('channel_configs_user_idx').on(t.userId)]
);

export type ChannelConfig = typeof channelConfigsTable.$inferSelect;
export type NewChannelConfig = typeof channelConfigsTable.$inferInsert;

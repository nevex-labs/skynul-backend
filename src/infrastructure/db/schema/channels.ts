import { boolean, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const channelGlobalSettings = pgTable('channel_global_settings', {
  id: serial('id').primaryKey(),
  autoApprove: boolean('auto_approve').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const channelSettings = pgTable('channel_settings', {
  id: serial('id').primaryKey(),
  channelId: varchar('channel_id', { length: 50 }).notNull().unique(),
  enabled: boolean('enabled').notNull().default(false),
  status: varchar('status', { length: 20 }).notNull().default('disconnected'),
  paired: boolean('paired').notNull().default(false),
  pairingCode: varchar('pairing_code', { length: 255 }),
  error: text('error'),
  hasCredentials: boolean('has_credentials').notNull().default(false),
  credentials: jsonb('credentials').default({}),
  meta: jsonb('meta').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type ChannelGlobalSetting = typeof channelGlobalSettings.$inferSelect;
export type NewChannelGlobalSetting = typeof channelGlobalSettings.$inferInsert;
export type ChannelSetting = typeof channelSettings.$inferSelect;
export type NewChannelSetting = typeof channelSettings.$inferInsert;

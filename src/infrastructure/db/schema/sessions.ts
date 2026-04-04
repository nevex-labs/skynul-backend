import { integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  sessionId: varchar('session_id', { length: 255 }).notNull().unique(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  userId: varchar('user_id', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

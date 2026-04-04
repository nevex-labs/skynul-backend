import { index, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

export const sessions = pgTable(
  'sessions',
  {
    id: serial('id').primaryKey(),
    sessionId: varchar('session_id', { length: 255 }).notNull().unique(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    oauthSubject: varchar('oauth_subject', { length: 255 }).notNull(),
    appUserId: integer('app_user_id').references(() => users.id, { onDelete: 'set null' }),
    displayName: varchar('display_name', { length: 255 }),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [
    index('sessions_oauth_subject_idx').on(t.oauthSubject),
    index('sessions_app_user_id_idx').on(t.appUserId),
  ]
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

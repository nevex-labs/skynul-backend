import { pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const browserSnapshots = pgTable('browser_snapshots', {
  id: serial('id').primaryKey(),
  snapshotId: varchar('snapshot_id', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  url: text('url').notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export type BrowserSnapshot = typeof browserSnapshots.$inferSelect;
export type NewBrowserSnapshot = typeof browserSnapshots.$inferInsert;

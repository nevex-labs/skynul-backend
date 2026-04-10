import { bigint, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { usersTable } from './users';

export const agentFactsTable = pgTable(
  'agent_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usersTable.id, { onDelete: 'cascade' }),
    fact: text('fact').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [index('agent_facts_user_idx').on(t.userId)]
);

export type AgentFact = typeof agentFactsTable.$inferSelect;
export type NewAgentFact = typeof agentFactsTable.$inferInsert;

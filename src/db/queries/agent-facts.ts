import { desc, eq, ilike } from 'drizzle-orm';
import { db } from '../index';
import type { AgentFact, NewAgentFact } from '../schema/agent-facts';
import { agentFactsTable } from '../schema/agent-facts';

const TABLE = agentFactsTable;

export async function saveFact(input: NewAgentFact) {
  const existing = await db
    .select()
    .from(TABLE)
    .where(eq(TABLE.fact, input.fact))
    .then((rows) => rows[0]);

  if (existing) {
    await db.update(TABLE).set({ createdAt: input.createdAt }).where(eq(TABLE.id, existing.id));
    return existing.id;
  }
  const [row] = await db.insert(TABLE).values(input).returning();
  return row.id;
}

export async function deleteFact(id: string) {
  await db.delete(TABLE).where(eq(TABLE.id, id));
}

export async function listFacts(userId: string): Promise<AgentFact[]> {
  return db.select().from(TABLE).where(eq(TABLE.userId, userId)).orderBy(desc(TABLE.createdAt)) as Promise<AgentFact[]>;
}

export async function searchFacts(query: string, limit = 5): Promise<AgentFact[]> {
  const pattern = `%${query}%`;
  return db
    .select()
    .from(TABLE)
    .where(ilike(TABLE.fact, pattern))
    .orderBy(desc(TABLE.createdAt))
    .limit(limit) as Promise<AgentFact[]>;
}

export async function getFactsByUser(userId: string): Promise<AgentFact[]> {
  return db.select().from(TABLE).where(eq(TABLE.userId, userId)).orderBy(desc(TABLE.createdAt)) as Promise<AgentFact[]>;
}

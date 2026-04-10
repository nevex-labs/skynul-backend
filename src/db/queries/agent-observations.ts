import { and, desc, eq, gte, ilike, isNull } from 'drizzle-orm';
import { db } from '../index';
import type { AgentObservation, NewAgentObservation } from '../schema/agent-observations';
import { agentObservationsTable } from '../schema/agent-observations';

const TABLE = agentObservationsTable;

export async function saveObservation(input: NewAgentObservation) {
  if (input.topicKey) {
    const existing = await db
      .select()
      .from(TABLE)
      .where(and(eq(TABLE.topicKey, input.topicKey), isNull(TABLE.deletedAt)))
      .then((rows) => rows[0]);

    if (existing) {
      await db
        .update(TABLE)
        .set({
          title: input.title,
          content: input.content,
          type: input.type,
          project: input.project,
          scope: input.scope,
          normalizedHash: input.normalizedHash,
          revisionCount: existing.revisionCount + 1,
          updatedAt: input.updatedAt,
        })
        .where(eq(TABLE.id, existing.id));
      return existing.id;
    }
  }

  const cutoff = Date.now() - 15 * 60 * 1000;
  if (input.normalizedHash) {
    const dup = await db
      .select()
      .from(TABLE)
      .where(and(eq(TABLE.normalizedHash, input.normalizedHash), gte(TABLE.createdAt, cutoff), isNull(TABLE.deletedAt)))
      .then((rows) => rows[0]);

    if (dup) {
      await db
        .update(TABLE)
        .set({
          duplicateCount: dup.duplicateCount + 1,
          lastSeenAt: input.lastSeenAt,
          updatedAt: input.updatedAt,
        })
        .where(eq(TABLE.id, dup.id));
      return dup.id;
    }
  }

  const [row] = await db.insert(TABLE).values(input).returning();
  return row.id;
}

export async function searchObservations(
  query: string,
  opts: { type_filter?: string; project?: string; limit?: number } = {}
): Promise<AgentObservation[]> {
  const pattern = `%${query}%`;
  const conditions = [ilike(TABLE.title, pattern), isNull(TABLE.deletedAt)];

  if (opts.type_filter) {
    conditions.push(eq(TABLE.type, opts.type_filter));
  }
  if (opts.project) {
    conditions.push(eq(TABLE.project, opts.project));
  }

  return db
    .select()
    .from(TABLE)
    .where(and(...conditions))
    .orderBy(desc(TABLE.updatedAt))
    .limit(opts.limit ?? 10) as Promise<AgentObservation[]>;
}

export async function getRecentObservations(
  opts: { type_filter?: string; project?: string; limit?: number } = {}
): Promise<AgentObservation[]> {
  const conditions = [isNull(TABLE.deletedAt)];

  if (opts.type_filter) {
    conditions.push(eq(TABLE.type, opts.type_filter));
  }
  if (opts.project) {
    conditions.push(eq(TABLE.project, opts.project));
  }

  return db
    .select()
    .from(TABLE)
    .where(and(...conditions))
    .orderBy(desc(TABLE.updatedAt))
    .limit(opts.limit ?? 20) as Promise<AgentObservation[]>;
}

export async function deleteObservation(id: string) {
  await db.update(TABLE).set({ deletedAt: Date.now() }).where(eq(TABLE.id, id));
}

export async function getObservationsByUser(userId: string): Promise<AgentObservation[]> {
  return db
    .select()
    .from(TABLE)
    .where(and(eq(TABLE.userId, userId), isNull(TABLE.deletedAt)))
    .orderBy(desc(TABLE.updatedAt)) as Promise<AgentObservation[]>;
}

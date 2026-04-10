import { createHash } from 'crypto';
import {
  deleteFact as dbDeleteFact,
  listFacts as dbListFacts,
  saveFact as dbSaveFact,
  searchFacts as dbSearchFacts,
} from '../../db/queries/agent-facts';
import {
  deleteObservation as dbDeleteObservation,
  getRecentObservations as dbGetRecentObservations,
  saveObservation as dbSaveObservation,
  searchObservations as dbSearchObservations,
} from '../../db/queries/agent-observations';
import { saveMemory as dbSaveMemory, searchMemories as dbSearchMemories } from '../../db/queries/task-memories';

export type Observation = {
  id: string;
  task_id?: string;
  type: string;
  title: string;
  content: string;
  project?: string;
  scope: string;
  topic_key?: string;
  normalized_hash?: string;
  revision_count: number;
  duplicate_count: number;
  last_seen_at?: number;
  created_at: number;
  updated_at: number;
  deleted_at?: number;
};

export function hashNormalized(title: string, content: string): string {
  const normalized = `${title.trim().toLowerCase()}|${content.trim().toLowerCase()}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

const _DEDUP_WINDOW_MS = 15 * 60 * 1000;

export async function saveMemory(entry: {
  taskId: string;
  prompt: string;
  outcome: 'completed' | 'failed';
  learnings: string;
  provider?: string;
  durationMs?: number;
}): Promise<void> {
  try {
    await dbSaveMemory({
      userId: 'system',
      taskId: entry.taskId,
      prompt: entry.prompt,
      outcome: entry.outcome,
      learnings: entry.learnings,
      provider: entry.provider ?? null,
      durationMs: entry.durationMs ?? null,
      createdAt: Date.now(),
    });
  } catch {
    /* non-critical */
  }
}

export async function searchMemories(
  query: string,
  limit = 3
): Promise<
  {
    prompt: string;
    outcome: 'completed' | 'failed';
    learnings: string;
  }[]
> {
  try {
    const rows = await dbSearchMemories(query, limit);
    return rows.map((r) => ({
      prompt: r.prompt,
      outcome: r.outcome as 'completed' | 'failed',
      learnings: r.learnings,
    }));
  } catch {
    return [];
  }
}

export function formatMemoriesForPrompt(memories: { prompt: string; outcome: string; learnings: string }[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((m, i) => {
    const status = m.outcome === 'completed' ? 'SUCCESS' : 'FAILED';
    return `[Memory ${i + 1}] (${status}) Task: "${m.prompt}"\n${m.learnings}`;
  });
  return `\n## Past experience (use working selectors and avoid failed strategies):\n${lines.join('\n\n')}\n`;
}

export async function saveFact(fact: string): Promise<void> {
  try {
    await dbSaveFact({
      userId: 'system',
      fact: fact.trim(),
      createdAt: Date.now(),
    });
  } catch {
    /* non-critical */
  }
}

export async function deleteFact(id: string): Promise<void> {
  try {
    await dbDeleteFact(id);
  } catch {
    /* non-critical */
  }
}

export async function listFacts(): Promise<{ id: string; fact: string }[]> {
  try {
    const rows = await dbListFacts('system');
    return rows.map((r) => ({ id: r.id, fact: r.fact }));
  } catch {
    return [];
  }
}

export async function searchFacts(query: string, limit = 5): Promise<string[]> {
  try {
    const rows = await dbSearchFacts(query, limit);
    return rows.map((r) => r.fact);
  } catch {
    return [];
  }
}

export function formatFactsForPrompt(facts: string[]): string {
  if (facts.length === 0) return '';
  return `\n## Your memory (facts you know about the user and environment):\n${facts.map((f) => `- ${f}`).join('\n')}\n`;
}

export async function saveObservation(params: {
  title: string;
  content: string;
  task_id?: string;
  obs_type?: string;
  project?: string;
  scope?: string;
  topic_key?: string;
}): Promise<string> {
  try {
    return await dbSaveObservation({
      userId: 'system',
      taskId: params.task_id,
      type: params.obs_type ?? 'manual',
      title: params.title,
      content: params.content,
      project: params.project,
      scope: params.scope ?? 'project',
      topicKey: params.topic_key,
      normalizedHash: hashNormalized(params.title, params.content),
      revisionCount: 1,
      duplicateCount: 1,
      lastSeenAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  } catch {
    return '';
  }
}

export async function searchObservations(
  query: string,
  opts: { type_filter?: string; project?: string; limit?: number } = {}
): Promise<Observation[]> {
  try {
    const rows = await dbSearchObservations(query, opts);
    return rows.map((r) => ({
      id: r.id,
      task_id: r.taskId ?? undefined,
      type: r.type,
      title: r.title,
      content: r.content,
      project: r.project ?? undefined,
      scope: r.scope,
      topic_key: r.topicKey ?? undefined,
      normalized_hash: r.normalizedHash ?? undefined,
      revision_count: r.revisionCount,
      duplicate_count: r.duplicateCount,
      last_seen_at: r.lastSeenAt ?? undefined,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      deleted_at: r.deletedAt ?? undefined,
    }));
  } catch {
    return [];
  }
}

export async function getRecentObservations(
  opts: { type_filter?: string; project?: string; limit?: number } = {}
): Promise<Observation[]> {
  try {
    const rows = await dbGetRecentObservations(opts);
    return rows.map((r) => ({
      id: r.id,
      task_id: r.taskId ?? undefined,
      type: r.type,
      title: r.title,
      content: r.content,
      project: r.project ?? undefined,
      scope: r.scope,
      topic_key: r.topicKey ?? undefined,
      normalized_hash: r.normalizedHash ?? undefined,
      revision_count: r.revisionCount,
      duplicate_count: r.duplicateCount,
      last_seen_at: r.lastSeenAt ?? undefined,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      deleted_at: r.deletedAt ?? undefined,
    }));
  } catch {
    return [];
  }
}

export async function deleteObservation(id: string): Promise<void> {
  try {
    await dbDeleteObservation(id);
  } catch {
    /* non-critical */
  }
}

export function formatObservationsForPrompt(obs: Observation[]): string {
  if (obs.length === 0) return '';
  const lines = obs.map((o) => {
    const meta = [o.type, o.topic_key ? `key:${o.topic_key}` : null].filter(Boolean).join(', ');
    return `[${meta}] **${o.title}**: ${o.content}`;
  });
  return `\n## Knowledge memory:\n${lines.join('\n')}\n`;
}

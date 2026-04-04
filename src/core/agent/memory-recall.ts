/**
 * Memory Recall — LLM-based intelligent memory selection for API REST.
 *
 * Strategy:
 * 1. Fast FTS5 retrieval (candidates)
 * 2. LLM-based relevance ranking (select top N)
 * 3. Format as "virtual MEMORY.md" for prompt injection
 *
 * This is better than file-based for API REST because:
 * - PostgreSQL handles concurrency
 * - Full-text search is fast (<10ms)
 * - LLM ranking adds intelligence without file I/O overhead
 */

import type { Effect } from 'effect';
import type { ObservationDto } from '../../infrastructure/db/schema/task-memory';
import type { ProviderId } from '../../shared/types';
import { childLogger } from '../logger';
import { getSummarizationModel } from './compaction/auto-compact';

const logger = childLogger({ component: 'memory-recall' });

// Re-export Observation type for compatibility
export type Observation = ObservationDto;

export type RecallConfig = {
  candidatePool: number;
  maxMemories: number;
  includeRecent: boolean;
  recentCount: number;
  minRelevance: number;
};

export const DEFAULT_RECALL_CONFIG: RecallConfig = {
  candidatePool: 20,
  maxMemories: 5,
  includeRecent: true,
  recentCount: 3,
  minRelevance: 0.6,
};

type ScoredMemory = {
  memory: Observation;
  relevance: number;
  reason: string;
};

/**
 * @deprecated Use buildCandidatePoolAsync with TaskMemoryService instead.
 * This stub returns empty array. PostgreSQL migration requires async service calls.
 */
export function buildCandidatePool(
  _query: string,
  _opts: {
    project?: string;
    type_filter?: string;
    config?: Partial<RecallConfig>;
  } = {}
): Observation[] {
  // TODO: Migrate to PostgreSQL + Drizzle using TaskMemoryService
  // This requires making the function async which breaks existing sync callers
  return [];
}

/**
 * Async version using TaskMemoryService (PostgreSQL).
 */
export async function buildCandidatePoolAsync(
  userId: number,
  query: string,
  opts: {
    project?: string;
    type_filter?: string;
    config?: Partial<RecallConfig>;
  } = {}
): Promise<Observation[]> {
  const cfg = { ...DEFAULT_RECALL_CONFIG, ...opts.config };
  const candidates = new Map<number, Observation>();

  const { TaskMemoryService, TaskMemoryServiceLive } = await import('../../services/task-memory');
  const { DatabaseLive } = await import('../../services/database');
  const { Effect } = await import('effect');

  const runEffect = <T>(effect: Effect.Effect<T, unknown, unknown>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(TaskMemoryServiceLive), Effect.provide(DatabaseLive)) as Effect.Effect<T>
    );

  // Search observations
  const ftsResults = await runEffect(
    Effect.flatMap(TaskMemoryService, (service) =>
      service.searchObservations(userId, query, {
        project: opts.project,
        limit: cfg.candidatePool,
      })
    )
  );

  for (const obs of ftsResults) {
    candidates.set(obs.id, obs as Observation);
  }

  if (cfg.includeRecent) {
    const recent = await runEffect(
      Effect.flatMap(TaskMemoryService, (service) =>
        service.getRecentObservations(userId, {
          project: opts.project,
          limit: cfg.recentCount,
        })
      )
    );

    for (const obs of recent) {
      if (!candidates.has(obs.id)) {
        candidates.set(obs.id, obs as Observation);
      }
    }
  }

  return Array.from(candidates.values());
}

export async function rankMemoriesWithLLM(
  query: string,
  candidates: Observation[],
  provider: ProviderId,
  config?: Partial<RecallConfig>
): Promise<ScoredMemory[]> {
  const cfg = { ...DEFAULT_RECALL_CONFIG, ...config };

  if (candidates.length === 0) {
    return [];
  }

  if (candidates.length <= cfg.maxMemories) {
    return candidates.map((m) => ({
      memory: m,
      relevance: 1.0,
      reason: 'Few candidates, no ranking needed',
    }));
  }

  const manifest = candidates
    .map((obs, i) => {
      const meta = [obs.type, obs.topicKey ? `key:${obs.topicKey}` : null].filter(Boolean).join(', ');
      return `[${i}] ${meta}: ${obs.title}\n${obs.content.slice(0, 200)}`;
    })
    .join('\n\n');

  const prompt = `Rate memory relevance for query: "${query}"\n\n${manifest}\n\nReturn JSON: {"rankings": [{"index": 0, "relevance": 0.9, "reason": "why"}]}`;

  try {
    const { callVision } = await import('./vision-dispatch');

    const result = await callVision(
      provider,
      prompt,
      [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      'memory-recall',
      getSummarizationModel(provider)
    );

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return candidates.slice(0, cfg.maxMemories).map((m) => ({
        memory: m,
        relevance: 0.8,
        reason: 'Fallback: no JSON',
      }));
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      rankings: Array<{ index: number; relevance: number; reason: string }>;
    };

    return parsed.rankings
      .filter((r) => r.index >= 0 && r.index < candidates.length)
      .map((r) => ({
        memory: candidates[r.index]!,
        relevance: Math.max(0, Math.min(1, r.relevance)),
        reason: r.reason,
      }))
      .filter((s) => s.relevance >= cfg.minRelevance)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, cfg.maxMemories);
  } catch (error) {
    logger.warn({ error }, 'LLM ranking failed');
    return candidates.slice(0, cfg.maxMemories).map((m) => ({
      memory: m,
      relevance: 0.7,
      reason: 'Fallback: error',
    }));
  }
}

export async function recallMemories(
  userId: number,
  query: string,
  provider: ProviderId,
  opts: {
    project?: string;
    type_filter?: string;
    config?: Partial<RecallConfig>;
  } = {}
): Promise<ScoredMemory[]> {
  const candidates = await buildCandidatePoolAsync(userId, query, opts);

  if (candidates.length === 0) {
    return [];
  }

  return rankMemoriesWithLLM(query, candidates, provider, opts.config);
}

export function formatAsMemoryContext(scored: ScoredMemory[]): string {
  if (scored.length === 0) {
    return '';
  }

  const lines = ['## Relevant memories', ''];

  for (const { memory, relevance, reason } of scored) {
    const meta = [
      memory.type,
      memory.topicKey ? `key:${memory.topicKey}` : null,
      `score:${(relevance * 100).toFixed(0)}%`,
    ]
      .filter(Boolean)
      .join(', ');

    lines.push(`### [${meta}] ${memory.title}`);
    lines.push(memory.content);
    lines.push(`> ${reason}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * @deprecated Use recallMemoriesAsync with TaskMemoryService instead.
 * This stub returns empty string. PostgreSQL migration requires async service calls.
 */
export function recallMemoriesFast(
  _query: string,
  _opts: {
    project?: string;
    type_filter?: string;
    limit?: number;
  } = {}
): string {
  // TODO: Migrate to PostgreSQL + Drizzle using TaskMemoryService
  // This requires making the function async which breaks existing sync callers
  return '';
}

/**
 * Async version using TaskMemoryService (PostgreSQL).
 */
export async function recallMemoriesFastAsync(
  userId: number,
  query: string,
  opts: {
    project?: string;
    type_filter?: string;
    limit?: number;
  } = {}
): Promise<string> {
  const candidates = await buildCandidatePoolAsync(userId, query, {
    ...opts,
    config: { maxMemories: opts.limit ?? 5 },
  });

  if (candidates.length === 0) {
    return '';
  }

  const lines = ['## Relevant memories', ''];

  for (const obs of candidates.slice(0, opts.limit ?? 5)) {
    const meta = [obs.type, obs.topicKey ? `key:${obs.topicKey}` : null].filter(Boolean).join(', ');

    lines.push(`### [${meta}] ${obs.title}`);
    lines.push(obs.content);
    lines.push('');
  }

  return lines.join('\n');
}

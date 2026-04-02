/**
 * Memory Recall — LLM-based intelligent memory selection for API REST.
 *
 * Strategy:
 * 1. Fast FTS5 retrieval (candidates)
 * 2. LLM-based relevance ranking (select top N)
 * 3. Format as "virtual MEMORY.md" for prompt injection
 *
 * This is better than file-based for API REST because:
 * - SQLite handles concurrency
 * - FTS5 is fast (<10ms)
 * - LLM ranking adds intelligence without file I/O overhead
 */

import type { ProviderId } from '../../types';
import { childLogger } from '../logger';
import { getSummarizationModel } from './compaction/auto-compact';
import { type Observation, getRecentObservations, searchObservations } from './task-memory';

const logger = childLogger({ component: 'memory-recall' });

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

export function buildCandidatePool(
  query: string,
  opts: {
    project?: string;
    type_filter?: string;
    config?: Partial<RecallConfig>;
  } = {}
): Observation[] {
  const cfg = { ...DEFAULT_RECALL_CONFIG, ...opts.config };
  const candidates = new Map<number, Observation>();

  const ftsResults = searchObservations(query, {
    project: opts.project,
    type_filter: opts.type_filter,
    limit: cfg.candidatePool,
  });

  for (const obs of ftsResults) {
    candidates.set(obs.id, obs);
  }

  if (cfg.includeRecent) {
    const recent = getRecentObservations({
      project: opts.project,
      type_filter: opts.type_filter,
      limit: cfg.recentCount,
    });

    for (const obs of recent) {
      if (!candidates.has(obs.id)) {
        candidates.set(obs.id, obs);
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
      const meta = [obs.type, obs.topic_key ? `key:${obs.topic_key}` : null].filter(Boolean).join(', ');
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
  query: string,
  provider: ProviderId,
  opts: {
    project?: string;
    type_filter?: string;
    config?: Partial<RecallConfig>;
  } = {}
): Promise<ScoredMemory[]> {
  const candidates = buildCandidatePool(query, opts);

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
      memory.topic_key ? `key:${memory.topic_key}` : null,
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

export function recallMemoriesFast(
  query: string,
  opts: {
    project?: string;
    type_filter?: string;
    limit?: number;
  } = {}
): string {
  const candidates = buildCandidatePool(query, {
    ...opts,
    config: { maxMemories: opts.limit ?? 5 },
  });

  if (candidates.length === 0) {
    return '';
  }

  const lines = ['## Relevant memories', ''];

  for (const obs of candidates.slice(0, opts.limit ?? 5)) {
    const meta = [obs.type, obs.topic_key ? `key:${obs.topic_key}` : null].filter(Boolean).join(', ');

    lines.push(`### [${meta}] ${obs.title}`);
    lines.push(obs.content);
    lines.push('');
  }

  return lines.join('\n');
}

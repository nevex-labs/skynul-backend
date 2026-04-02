import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RECALL_CONFIG, buildCandidatePool, formatAsMemoryContext, recallMemoriesFast } from './memory-recall';
import { type Observation, getRecentObservations, searchObservations } from './task-memory';

vi.mock('./task-memory', () => ({
  searchObservations: vi.fn(),
  getRecentObservations: vi.fn(),
}));

vi.mock('./vision-dispatch', () => ({
  callVision: vi.fn(),
}));

describe('DEFAULT_RECALL_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_RECALL_CONFIG.candidatePool).toBe(20);
    expect(DEFAULT_RECALL_CONFIG.maxMemories).toBe(5);
    expect(DEFAULT_RECALL_CONFIG.minRelevance).toBe(0.6);
  });
});

describe('buildCandidatePool', () => {
  it('combines FTS results with recent observations', () => {
    const ftsResults: Observation[] = [
      {
        id: 1,
        type: 'pattern',
        title: 'FTS match',
        content: 'Content',
        scope: 'project',
        revision_count: 1,
        duplicate_count: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    ];
    const recentResults: Observation[] = [
      {
        id: 2,
        type: 'fact',
        title: 'Recent',
        content: 'Recent content',
        scope: 'project',
        revision_count: 1,
        duplicate_count: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    ];

    vi.mocked(searchObservations).mockReturnValue(ftsResults);
    vi.mocked(getRecentObservations).mockReturnValue(recentResults);

    const pool = buildCandidatePool('test query');

    expect(pool).toHaveLength(2);
    expect(pool.map((o) => o.id)).toContain(1);
    expect(pool.map((o) => o.id)).toContain(2);
  });

  it('deduplicates by id', () => {
    const obs: Observation = {
      id: 1,
      type: 'pattern',
      title: 'Test',
      content: 'Content',
      scope: 'project',
      revision_count: 1,
      duplicate_count: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    vi.mocked(searchObservations).mockReturnValue([obs]);
    vi.mocked(getRecentObservations).mockReturnValue([obs]);

    const pool = buildCandidatePool('test');

    expect(pool).toHaveLength(1);
  });
});

describe('recallMemoriesFast', () => {
  it('returns formatted context string', () => {
    const obs: Observation = {
      id: 1,
      type: 'pattern',
      title: 'Redis caching',
      content: 'Use Redis for sessions',
      scope: 'project',
      topic_key: 'redis',
      revision_count: 1,
      duplicate_count: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    vi.mocked(searchObservations).mockReturnValue([obs]);
    vi.mocked(getRecentObservations).mockReturnValue([]);

    const context = recallMemoriesFast('redis');

    expect(context).toContain('Relevant memories');
    expect(context).toContain('Redis caching');
    expect(context).toContain('Use Redis for sessions');
  });

  it('returns empty string when no candidates', () => {
    vi.mocked(searchObservations).mockReturnValue([]);
    vi.mocked(getRecentObservations).mockReturnValue([]);

    const context = recallMemoriesFast('unknown');

    expect(context).toBe('');
  });
});

describe('formatAsMemoryContext', () => {
  it('formats scored memories', () => {
    const obs: Observation = {
      id: 1,
      type: 'pattern',
      title: 'Auth',
      content: 'JWT pattern',
      scope: 'project',
      revision_count: 1,
      duplicate_count: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const formatted = formatAsMemoryContext([{ memory: obs, relevance: 0.95, reason: 'Direct match' }]);

    expect(formatted).toContain('Relevant memories');
    expect(formatted).toContain('Auth');
    expect(formatted).toContain('JWT pattern');
    expect(formatted).toContain('95%');
    expect(formatted).toContain('Direct match');
  });

  it('returns empty for empty input', () => {
    expect(formatAsMemoryContext([])).toBe('');
  });
});

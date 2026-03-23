import { beforeEach, describe, expect, it } from 'vitest';
import {
  _initDbForTest,
  deleteObservation,
  formatObservationsForPrompt,
  getRecentObservations,
  hashNormalized,
  saveObservation,
  searchObservations,
} from './task-memory';

beforeEach(() => {
  _initDbForTest();
});

describe('hashNormalized', () => {
  it('returns same hash for identical title+content', () => {
    expect(hashNormalized('title', 'content')).toBe(hashNormalized('title', 'content'));
  });

  it('returns different hash for different content', () => {
    expect(hashNormalized('a', 'b')).not.toBe(hashNormalized('a', 'c'));
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(hashNormalized('  Hello ', '  World  ')).toBe(hashNormalized('hello', 'world'));
  });

  it('returns a non-empty string', () => {
    const h = hashNormalized('test', 'value');
    expect(typeof h).toBe('string');
    expect(h.length).toBeGreaterThan(0);
  });
});

describe('saveObservation', () => {
  it('inserts a new observation and returns an id', () => {
    const id = saveObservation({ title: 'Lesson learned', content: 'Always check null first' });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('stores default type=manual, scope=project', () => {
    const id = saveObservation({ title: 'Test', content: 'Content' });
    const obs = getRecentObservations();
    const found = obs.find((o) => o.id === id);
    expect(found).toBeDefined();
    expect(found!.type).toBe('manual');
    expect(found!.scope).toBe('project');
    expect(found!.revision_count).toBe(1);
    expect(found!.duplicate_count).toBe(1);
  });

  it('stores custom obs_type', () => {
    saveObservation({ title: 'Bug fix', content: 'Fixed null ref', obs_type: 'bugfix' });
    const obs = getRecentObservations({ type_filter: 'bugfix' });
    expect(obs.length).toBe(1);
    expect(obs[0].type).toBe('bugfix');
  });

  it('stores project field', () => {
    const id = saveObservation({ title: 'T', content: 'C', project: 'skynul' });
    const obs = getRecentObservations({ project: 'skynul' });
    expect(obs.length).toBe(1);
    expect(obs[0].id).toBe(id);
    expect(obs[0].project).toBe('skynul');
  });

  it('stores task_id field', () => {
    const id = saveObservation({ title: 'T', content: 'C', task_id: 'task_abc' });
    const obs = getRecentObservations();
    const found = obs.find((o) => o.id === id);
    expect(found!.task_id).toBe('task_abc');
  });

  it('upserts by topic_key — updates content and bumps revision_count', () => {
    const id1 = saveObservation({ title: 'Auth pattern', content: 'v1', topic_key: 'auth-pattern' });
    const id2 = saveObservation({ title: 'Auth pattern', content: 'v2', topic_key: 'auth-pattern' });
    expect(id2).toBe(id1);
    const obs = getRecentObservations();
    const found = obs.find((o) => o.id === id1)!;
    expect(found.content).toBe('v2');
    expect(found.revision_count).toBe(2);
  });

  it('topic_key upsert updates updated_at', () => {
    const id = saveObservation({ title: 'T', content: 'v1', topic_key: 'key-ts' });
    const before = getRecentObservations().find((o) => o.id === id)!.updated_at;
    saveObservation({ title: 'T', content: 'v2', topic_key: 'key-ts' });
    const after = getRecentObservations().find((o) => o.id === id)!.updated_at;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('different topic_keys create separate rows', () => {
    const id1 = saveObservation({ title: 'T', content: 'C1', topic_key: 'key-a' });
    const id2 = saveObservation({ title: 'T', content: 'C2', topic_key: 'key-b' });
    expect(id1).not.toBe(id2);
    expect(getRecentObservations().length).toBe(2);
  });

  it('deduplicates exact hash within 15-minute window', () => {
    const id1 = saveObservation({ title: 'Dup', content: 'same content' });
    const id2 = saveObservation({ title: 'Dup', content: 'same content' });
    expect(id2).toBe(id1);
    const obs = getRecentObservations();
    const found = obs.find((o) => o.id === id1)!;
    expect(found.duplicate_count).toBe(2);
  });

  it('inserts new row for different content even with same title', () => {
    const id1 = saveObservation({ title: 'A', content: 'different1' });
    const id2 = saveObservation({ title: 'A', content: 'different2' });
    expect(id2).not.toBe(id1);
    expect(getRecentObservations().length).toBe(2);
  });

  it('sets timestamps on insert', () => {
    const before = Date.now();
    const id = saveObservation({ title: 'T', content: 'C' });
    const after = Date.now();
    const obs = getRecentObservations().find((o) => o.id === id)!;
    expect(obs.created_at).toBeGreaterThanOrEqual(before);
    expect(obs.created_at).toBeLessThanOrEqual(after);
    expect(obs.updated_at).toBeGreaterThanOrEqual(before);
  });
});

describe('searchObservations', () => {
  beforeEach(() => {
    saveObservation({ title: 'Login bug fixed', content: 'null check was missing in auth middleware' });
    saveObservation({ title: 'Caching pattern', content: 'use Redis for session storage' });
    saveObservation({ title: 'Deploy process', content: 'fly deploy with ha=false for single machine' });
  });

  it('finds observations matching title', () => {
    const results = searchObservations('Login bug');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Login bug fixed');
  });

  it('finds observations matching content', () => {
    const results = searchObservations('Redis session');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Caching pattern');
  });

  it('returns empty array when no match', () => {
    const results = searchObservations('xyznonexistent99');
    expect(results).toHaveLength(0);
  });

  it('filters by type_filter', () => {
    saveObservation({ title: 'A decision', content: 'use TypeScript everywhere', obs_type: 'decision' });
    const results = searchObservations('TypeScript', { type_filter: 'decision' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.type === 'decision')).toBe(true);
  });

  it('filters by project', () => {
    saveObservation({ title: 'P obs', content: 'project specific finding', project: 'proj-x' });
    const results = searchObservations('project specific', { project: 'proj-x' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.project === 'proj-x')).toBe(true);
  });

  it('respects limit', () => {
    const results = searchObservations('process', { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('excludes soft-deleted observations', () => {
    const id = saveObservation({ title: 'To delete', content: 'will be gone soon' });
    deleteObservation(id);
    const results = searchObservations('gone soon');
    expect(results.find((r) => r.id === id)).toBeUndefined();
  });
});

describe('getRecentObservations', () => {
  it('returns observations ordered by updated_at desc', () => {
    saveObservation({ title: 'First', content: 'c1' });
    saveObservation({ title: 'Second', content: 'c2' });
    const obs = getRecentObservations();
    expect(obs.length).toBe(2);
    expect(obs[0].title).toBe('Second');
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      saveObservation({ title: `obs ${i}`, content: `content ${i}` });
    }
    const obs = getRecentObservations({ limit: 3 });
    expect(obs.length).toBe(3);
  });

  it('filters by project', () => {
    saveObservation({ title: 'Global', content: 'global', project: undefined });
    saveObservation({ title: 'Proj', content: 'proj', project: 'alpha' });
    const obs = getRecentObservations({ project: 'alpha' });
    expect(obs.length).toBe(1);
    expect(obs[0].project).toBe('alpha');
  });

  it('filters by type_filter', () => {
    saveObservation({ title: 'D', content: 'decision', obs_type: 'decision' });
    saveObservation({ title: 'P', content: 'pattern', obs_type: 'pattern' });
    const dec = getRecentObservations({ type_filter: 'decision' });
    expect(dec.length).toBe(1);
    expect(dec[0].type).toBe('decision');
  });

  it('excludes soft-deleted', () => {
    const id = saveObservation({ title: 'Del', content: 'gone' });
    deleteObservation(id);
    const obs = getRecentObservations();
    expect(obs.find((o) => o.id === id)).toBeUndefined();
  });

  it('returns empty array when nothing saved', () => {
    expect(getRecentObservations()).toHaveLength(0);
  });
});

describe('deleteObservation', () => {
  it('soft deletes — observation no longer appears in getRecentObservations', () => {
    const id = saveObservation({ title: 'Soft', content: 'delete me' });
    deleteObservation(id);
    expect(getRecentObservations().find((o) => o.id === id)).toBeUndefined();
  });

  it('is idempotent — calling twice does not throw', () => {
    const id = saveObservation({ title: 'X', content: 'y' });
    deleteObservation(id);
    deleteObservation(id);
    expect(getRecentObservations().find((o) => o.id === id)).toBeUndefined();
  });

  it('does not affect other observations', () => {
    const id1 = saveObservation({ title: 'Keep', content: 'keep me' });
    const id2 = saveObservation({ title: 'Remove', content: 'remove me' });
    deleteObservation(id2);
    const obs = getRecentObservations();
    expect(obs.find((o) => o.id === id1)).toBeDefined();
    expect(obs.find((o) => o.id === id2)).toBeUndefined();
  });
});

describe('formatObservationsForPrompt', () => {
  it('returns empty string for empty array', () => {
    expect(formatObservationsForPrompt([])).toBe('');
  });

  it('includes title and content', () => {
    const obs = getRecentObservations();
    saveObservation({ title: 'Useful fact', content: 'Use Redis for caching' });
    const fresh = getRecentObservations();
    const formatted = formatObservationsForPrompt(fresh);
    expect(formatted).toContain('Useful fact');
    expect(formatted).toContain('Use Redis for caching');
  });

  it('includes type and topic_key when present', () => {
    saveObservation({ title: 'Pattern', content: 'Always validate', obs_type: 'pattern', topic_key: 'validation' });
    const fresh = getRecentObservations();
    const formatted = formatObservationsForPrompt(fresh);
    expect(formatted).toContain('pattern');
    expect(formatted).toContain('validation');
  });
});

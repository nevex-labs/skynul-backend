import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseLive } from '../../services/database';
import { TaskMemoryServiceTest } from '../../services/task-memory';
import {
  executeFactAction,
  executeMemoryAction,
  executeSetIdentity,
  executeShell,
  headTail,
  setTaskMemoryLayer,
} from './action-executors';
import type { ExecutorContext } from './action-executors';

// Set test layer
setTaskMemoryLayer(TaskMemoryServiceTest);

// Mock the runTaskMemoryEffect to use test layer
vi.mock('./action-executors', async () => {
  const { TaskMemoryService: TMS } = await import('../../services/task-memory');

  const mockService = TMS.of({
    saveMemory: () => Effect.succeed(undefined),
    searchMemories: () => Effect.succeed([]),
    formatMemoriesForPrompt: () => '',
    saveFact: () => Effect.succeed(undefined),
    deleteFact: () => Effect.succeed(undefined),
    listFacts: () => Effect.succeed([]),
    searchFacts: () => Effect.succeed([]),
    formatFactsForPrompt: () => '',
    saveObservation: () => Effect.succeed(1),
    searchObservations: () => Effect.succeed([]),
    getRecentObservations: () => Effect.succeed([]),
    deleteObservation: () => Effect.succeed(undefined),
    formatObservationsForPrompt: () => '',
  });

  const mockLayer = Layer.succeed(TMS, mockService);

  return {
    runTaskMemoryEffect: async (effect: any) => {
      const program = effect.pipe(Effect.provide(mockLayer), Effect.provide(DatabaseLive));
      return Effect.runPromise(program);
    },
  };
});

function makeCtx(overrides?: Partial<ExecutorContext>): ExecutorContext {
  return {
    task: {
      id: 't1',
      prompt: '',
      status: 'running',
      mode: 'code',
      steps: [],
      capabilities: [],
      maxSteps: 10,
      timeoutMs: 60000,
      createdAt: 0,
      updatedAt: 0,
      userId: 1,
    } as any,
    taskManager: null,
    appBridge: { run: vi.fn() } as any,
    pushUpdate: vi.fn(),
    pushStatus: vi.fn(),
    ...overrides,
  };
}

describe('headTail', () => {
  it('returns text unchanged if under limit', () => {
    expect(headTail('short', 100)).toBe('short');
  });

  it('keeps head and tail when over limit', () => {
    const text = 'a'.repeat(200);
    const result = headTail(text, 100);
    expect(result).toContain('aaaaaa');
    expect(result).toContain('[... 100 chars omitted ...]');
    expect(result).toContain('aaaaaa');
  });

  it('handles exactly limit length', () => {
    const text = 'x'.repeat(50);
    expect(headTail(text, 50)).toBe(text);
  });
});

describe('executeFactAction', () => {
  it('saves a fact with remember_fact', async () => {
    const ctx = makeCtx();
    const result = await executeFactAction(ctx, { type: 'remember_fact', fact: 'BTC is king' } as any);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('Remembered');
  });

  it('rejects remember_fact without fact string', async () => {
    const ctx = makeCtx();
    const result = await executeFactAction(ctx, { type: 'remember_fact' } as any);
    expect(result.ok).toBe(false);
  });

  it('deletes a fact with forget_fact', async () => {
    const ctx = makeCtx();
    const result = await executeFactAction(ctx, { type: 'forget_fact', factId: 0 } as any);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('Forgot');
  });

  it('rejects forget_fact without factId number', async () => {
    const ctx = makeCtx();
    const result = await executeFactAction(ctx, { type: 'forget_fact' } as any);
    expect(result.ok).toBe(false);
  });
});

describe('executeMemoryAction', () => {
  function makeMemoryCtx(): ExecutorContext {
    return {
      task: {
        id: 't1',
        prompt: '',
        status: 'running',
        mode: 'code',
        steps: [],
        capabilities: [],
        maxSteps: 10,
        timeoutMs: 60000,
        createdAt: 0,
        updatedAt: 0,
        userId: 1,
      } as any,
      taskManager: null,
      appBridge: { run: vi.fn() } as any,
      pushUpdate: vi.fn(),
      pushStatus: vi.fn(),
    };
  }

  it('memory_save returns success with observation id', async () => {
    const ctx = makeMemoryCtx();
    const res = await executeMemoryAction(ctx, { type: 'memory_save', title: 'Test', content: 'Value' } as any);
    expect(res.ok).toBe(true);
    expect(res.ok && res.value).toContain('Observation saved');
    expect(res.ok && res.value).toContain('Test');
  });

  it('memory_save requires title and content', async () => {
    const ctx = makeMemoryCtx();
    const res = await executeMemoryAction(ctx, { type: 'memory_save', title: '', content: '' } as any);
    expect(res.ok).toBe(false);
  });

  it('memory_search returns matching observations', async () => {
    const ctx = makeMemoryCtx();
    await executeMemoryAction(ctx, { type: 'memory_save', title: 'Redis caching', content: 'Use SET EX 3600' } as any);
    const res = await executeMemoryAction(ctx, { type: 'memory_search', query: 'Redis' } as any);
    expect(res.ok).toBe(true);
    expect(res.ok && res.value).toContain('Redis caching');
  });

  it('memory_search returns no match message when nothing found', async () => {
    const ctx = makeMemoryCtx();
    const res = await executeMemoryAction(ctx, { type: 'memory_search', query: 'xyznonexistent' } as any);
    expect(res.ok).toBe(true);
    expect(res.ok && res.value).toContain('No matching');
  });

  it('memory_search requires query', async () => {
    const ctx = makeMemoryCtx();
    const res = await executeMemoryAction(ctx, { type: 'memory_search', query: '' } as any);
    expect(res.ok).toBe(false);
  });

  it('memory_context returns recent observations', async () => {
    const ctx = makeMemoryCtx();
    await executeMemoryAction(ctx, {
      type: 'memory_save',
      title: 'Pattern A',
      content: 'Always validate input',
    } as any);
    const res = await executeMemoryAction(ctx, { type: 'memory_context' } as any);
    expect(res.ok).toBe(true);
    expect(res.ok && res.value).toContain('Pattern A');
  });

  it('memory_context returns empty message when nothing saved', async () => {
    const ctx = makeMemoryCtx();
    const res = await executeMemoryAction(ctx, { type: 'memory_context' } as any);
    expect(res.ok).toBe(true);
    expect(res.ok && res.value).toContain('No observations');
  });
});

describe('executeSetIdentity', () => {
  it('sets agent name and role', () => {
    const ctx = makeCtx();
    const result = executeSetIdentity(ctx, { type: 'set_identity', name: 'Atlas', role: 'Navigator' } as any);
    expect(result.ok).toBe(true);
    expect(ctx.task.agentName).toBe('Atlas');
    expect(ctx.task.agentRole).toBe('Navigator');
    expect(ctx.pushUpdate).toHaveBeenCalled();
  });

  it('sets only name if role is missing', () => {
    const ctx = makeCtx();
    const result = executeSetIdentity(ctx, { type: 'set_identity', name: 'Solo' } as any);
    expect(result.ok).toBe(true);
    expect(ctx.task.agentName).toBe('Solo');
  });
});

describe('executeShell', () => {
  it('runs a simple command', async () => {
    const result = await executeShell('echo hello');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('hello');
  });

  it('returns error for failing command', async () => {
    const result = await executeShell('false');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('Exit');
  });

  it('respects timeout', async () => {
    const result = await executeShell('sleep 10', undefined, 100);
    expect(result.ok).toBe(true);
  }, 5000);
});

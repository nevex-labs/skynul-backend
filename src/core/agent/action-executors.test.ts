import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeFactAction, executeSetIdentity, executeShell, headTail } from './action-executors';
import type { ExecutorContext } from './action-executors';

describe('headTail', () => {
  it('returns text unchanged if under limit', () => {
    expect(headTail('short', 100)).toBe('short');
  });

  it('keeps head and tail when over limit', () => {
    const text = 'a'.repeat(200);
    const result = headTail(text, 100);
    expect(result).toContain('aaaaaa'); // head
    expect(result).toContain('[... 100 chars omitted ...]');
    expect(result).toContain('aaaaaa'); // tail
  });

  it('handles exactly limit length', () => {
    const text = 'x'.repeat(50);
    expect(headTail(text, 50)).toBe(text);
  });
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
    } as any,
    taskManager: null,
    appBridge: { run: vi.fn() } as any,
    pushUpdate: vi.fn(),
    pushStatus: vi.fn(),
    ...overrides,
  };
}

describe('executeFactAction', () => {
  it('saves a fact with remember_fact', () => {
    const ctx = makeCtx();
    const result = executeFactAction(ctx, { type: 'remember_fact', fact: 'BTC is king' } as any);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('Remembered');
  });

  it('rejects remember_fact without fact string', () => {
    const ctx = makeCtx();
    const result = executeFactAction(ctx, { type: 'remember_fact' } as any);
    expect(result.ok).toBe(false);
  });

  it('deletes a fact with forget_fact', () => {
    const ctx = makeCtx();
    const result = executeFactAction(ctx, { type: 'forget_fact', factId: 0 } as any);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('Forgot');
  });

  it('rejects forget_fact without factId number', () => {
    const ctx = makeCtx();
    const result = executeFactAction(ctx, { type: 'forget_fact' } as any);
    expect(result.ok).toBe(false);
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
    expect(result.ok).toBe(true); // shell errors still return ok with exit code
    if (result.ok) expect(result.value).toContain('Exit');
  });

  it('respects timeout', async () => {
    const result = await executeShell('sleep 10', undefined, 100);
    // Should timeout and return an error-ish result
    expect(result.ok).toBe(true);
  }, 5000);
});

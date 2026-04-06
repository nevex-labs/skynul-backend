import { describe, expect, it, vi } from 'vitest';
import { type Task, type TaskRunnerOpts, buildSystemPrompt, createActionDispatcher, runTask } from './task-runner';

// ── buildSystemPrompt ──────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  const baseTask: Task = {
    id: 'task_1',
    prompt: 'list files',
    mode: 'code',
    capabilities: ['fs.read', 'cmd.run'],
    status: 'pending',
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('includes default behavior when no agent prompt', () => {
    const result = buildSystemPrompt({ task: baseTask });
    expect(result).toContain('autonomous agent');
    expect(result).toContain('Respond with JSON');
  });

  it('uses agentSystemPrompt when provided', () => {
    const result = buildSystemPrompt({
      task: baseTask,
      agentSystemPrompt: 'You are a trading bot.',
    });
    expect(result).toContain('trading bot');
    expect(result).not.toContain('autonomous agent');
  });

  it('includes capabilities', () => {
    const result = buildSystemPrompt({ task: baseTask });
    expect(result).toContain('fs.read, cmd.run');
  });

  it('includes memory context', () => {
    const result = buildSystemPrompt({
      task: baseTask,
      memoryContext: 'User prefers Python over JavaScript.',
    });
    expect(result).toContain('User prefers Python');
  });
});

// ── createActionDispatcher ─────────────────────────────────────────────

describe('createActionDispatcher', () => {
  it('dispatches to registered handler', async () => {
    const handler = vi.fn().mockResolvedValue('file contents');
    const dispatch = createActionDispatcher({ 'fs.read': handler });

    const result = await dispatch({ type: 'fs.read', path: '/test.txt' });

    expect(result).toBe('file contents');
    expect(handler).toHaveBeenCalledWith({ type: 'fs.read', path: '/test.txt' });
  });

  it('returns error for unregistered action', async () => {
    const dispatch = createActionDispatcher({ 'fs.read': vi.fn() });

    const result = await dispatch({ type: 'unknown.action' });

    expect(result).toContain('not registered');
    expect(result).toContain('fs.read');
  });
});

// ── runTask ────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_test',
    prompt: 'hello',
    mode: 'code',
    capabilities: ['fs.read'],
    status: 'pending',
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeOpts(overrides: Partial<TaskRunnerOpts> = {}): TaskRunnerOpts {
  return {
    task: makeTask(),
    provider: 'gemini',
    callLLM: vi.fn().mockResolvedValue(JSON.stringify({ type: 'done', summary: 'finished' })),
    callbacks: { onUpdate: vi.fn() },
    actionExecutors: { 'fs.read': vi.fn().mockResolvedValue('ok') },
    ...overrides,
  };
}

describe('runTask', () => {
  it('sets task status to running', async () => {
    const task = makeTask();
    const statuses: string[] = [];
    const onUpdate = vi.fn().mockImplementation((t: Task) => {
      statuses.push(t.status);
    });

    await runTask(makeOpts({ task, callbacks: { onUpdate } }));

    // First call should be 'running', last should be 'completed'
    expect(statuses[0]).toBe('running');
    expect(statuses[statuses.length - 1]).toBe('completed');
  });

  it('completes task when LLM returns done', async () => {
    const task = makeTask();
    const onUpdate = vi.fn();

    const result = await runTask(makeOpts({ task, callbacks: { onUpdate } }));

    expect(result.status).toBe('completed');
    expect(result.summary).toBe('finished');
  });

  it('fails task when LLM returns fail', async () => {
    const task = makeTask();

    const result = await runTask(
      makeOpts({
        task,
        callLLM: vi.fn().mockResolvedValue(JSON.stringify({ type: 'fail', reason: 'cant do it' })),
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error).toBe('cant do it');
  });

  it('calls onUpdate on each step', async () => {
    const task = makeTask();
    const onUpdate = vi.fn();

    const callLLM = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ type: 'fs.read', path: 'a.txt' }))
      .mockResolvedValueOnce(JSON.stringify({ type: 'done', summary: 'done' }));

    await runTask(makeOpts({ task, callLLM, callbacks: { onUpdate } }));

    // Calls: running + step1 recorded + step2(done) recorded + final update
    expect(onUpdate).toHaveBeenCalledTimes(4);
  });

  it('uses custom action executors', async () => {
    const task = makeTask();
    const executor = vi.fn().mockResolvedValue('custom result');

    await runTask(
      makeOpts({
        task,
        callLLM: vi
          .fn()
          .mockResolvedValueOnce(JSON.stringify({ type: 'custom.action' }))
          .mockResolvedValueOnce(JSON.stringify({ type: 'done', summary: 'done' })),
        actionExecutors: { 'custom.action': executor },
      })
    );

    expect(executor).toHaveBeenCalledWith({ type: 'custom.action' });
  });

  it('respects maxSteps', async () => {
    const task = makeTask();

    const result = await runTask(
      makeOpts({
        task,
        callLLM: vi.fn().mockResolvedValue(JSON.stringify({ type: 'fs.read', path: 'x' })),
        maxSteps: 2,
      })
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Reached max steps');
    expect(result.steps).toHaveLength(2);
  });

  it('includes memory context in system prompt', async () => {
    const task = makeTask();
    let capturedSystemPrompt = '';

    const callLLM = vi.fn().mockImplementation(async (messages) => {
      capturedSystemPrompt = messages.find((m: { role: string }) => m.role === 'system')?.content ?? '';
      return JSON.stringify({ type: 'done', summary: 'done' });
    });

    await runTask(
      makeOpts({
        task,
        callLLM,
        systemPrompt: 'You are helpful.\n\nContext:\nPrevious task: list files in /tmp',
      })
    );

    expect(capturedSystemPrompt).toContain('Previous task: list files in /tmp');
  });

  it('respects agentAllowedTools', async () => {
    const task = makeTask();
    const executor = vi.fn().mockResolvedValue('ok');

    const result = await runTask(
      makeOpts({
        task,
        callLLM: vi.fn().mockResolvedValue(JSON.stringify({ type: 'cmd.run', cmd: 'rm -rf /' })),
        actionExecutors: { 'cmd.run': executor },
        agentAllowedTools: ['fs.read'],
        maxSteps: 1,
      })
    );

    expect(result.steps[0].error).toContain('not allowed');
    expect(executor).not.toHaveBeenCalled();
  });

  it('updates task.updatedAt on completion', async () => {
    const task = makeTask();
    const beforeRun = Date.now();

    const result = await runTask(makeOpts({ task }));

    expect(result.updatedAt).toBeGreaterThanOrEqual(beforeRun);
  });
});

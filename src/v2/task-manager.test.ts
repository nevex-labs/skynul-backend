import { describe, expect, it, vi } from 'vitest';
import { type LoopSetupFn, type LoopSetupResult, createLoopRegistry } from './loop-registry';
import * as providerDispatch from './provider-dispatch';
import type { SecretReader } from './secret-reader';
import { type TaskCreateRequest, TaskManager, type TaskManagerOpts, TaskStore } from './task-manager';

vi.mock('./provider-dispatch', () => ({
  dispatchChat: vi.fn().mockResolvedValue(JSON.stringify({ type: 'done', summary: 'task completed' })),
  PROVIDER_CONFIGS: {},
}));

// ── Helpers ────────────────────────────────────────────────────────────

const mockSecretReader: SecretReader = async (key: string) => {
  if (key === 'gemini.apiKey') return 'sk-gemini-123';
  return null;
};

function makeLoopRegistry(setupFn?: LoopSetupFn) {
  const registry = createLoopRegistry();
  const defaultSetup: LoopSetupFn = () => ({
    actionExecutors: {
      'fs.read': async () => 'file contents',
      shell: async () => 'ok',
    },
    systemPrompt: 'You are helpful.',
    initialHistory: [{ role: 'user', content: 'hello' }],
  });
  registry.register('code', setupFn ?? defaultSetup);
  registry.register('browser', defaultSetup);
  registry.register('cdp', defaultSetup);
  return registry;
}

function makeOpts(overrides: Partial<TaskManagerOpts> = {}): TaskManagerOpts {
  return {
    readSecret: mockSecretReader,
    loopRegistry: makeLoopRegistry(),
    ...overrides,
  };
}

function makeStore(): TaskStore {
  return new TaskStore();
}

function makeManager(opts?: Partial<TaskManagerOpts>): TaskManager {
  return new TaskManager(makeStore(), makeOpts(opts));
}

function makeRequest(overrides: Partial<TaskCreateRequest> = {}): TaskCreateRequest {
  return {
    prompt: 'list files',
    ...overrides,
  };
}

// ── TaskStore ──────────────────────────────────────────────────────────

describe('TaskStore', () => {
  it('stores and retrieves tasks', () => {
    const store = makeStore();
    const task = {
      id: 'task_1',
      prompt: 'hello',
      mode: 'code' as const,
      capabilities: [],
      status: 'pending' as const,
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    store.set(task);
    const retrieved = store.get('task_1');

    expect(retrieved).toBeDefined();
    expect(retrieved!.prompt).toBe('hello');
  });

  it('returns undefined for missing tasks', () => {
    const store = makeStore();
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('lists all tasks sorted by creation date', () => {
    const store = makeStore();
    const now = Date.now();

    store.set({
      id: 'task_1',
      prompt: 'first',
      mode: 'code',
      capabilities: [],
      status: 'pending',
      steps: [],
      createdAt: now - 1000,
      updatedAt: now - 1000,
    });
    store.set({
      id: 'task_2',
      prompt: 'second',
      mode: 'code',
      capabilities: [],
      status: 'pending',
      steps: [],
      createdAt: now,
      updatedAt: now,
    });

    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('task_2');
    expect(list[1].id).toBe('task_1');
  });

  it('filters by userId', () => {
    const store = makeStore();
    const now = Date.now();

    store.set({
      id: 'task_1',
      prompt: 'user1 task',
      mode: 'code',
      capabilities: [],
      status: 'pending',
      steps: [],
      userId: 1,
      createdAt: now,
      updatedAt: now,
    });
    store.set({
      id: 'task_2',
      prompt: 'user2 task',
      mode: 'code',
      capabilities: [],
      status: 'pending',
      steps: [],
      userId: 2,
      createdAt: now,
      updatedAt: now,
    });

    const user1Tasks = store.list({ userId: 1 });
    expect(user1Tasks).toHaveLength(1);
    expect(user1Tasks[0].userId).toBe(1);
  });

  it('deletes tasks', () => {
    const store = makeStore();
    const task = {
      id: 'task_1',
      prompt: 'hello',
      mode: 'code' as const,
      capabilities: [],
      status: 'pending' as const,
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    store.set(task);
    expect(store.delete('task_1')).toBe(true);
    expect(store.get('task_1')).toBeUndefined();
    expect(store.delete('nonexistent')).toBe(false);
  });

  it('clears all tasks', () => {
    const store = makeStore();
    const now = Date.now();

    store.set({
      id: 'task_1',
      prompt: 'hello',
      mode: 'code',
      capabilities: [],
      status: 'pending',
      steps: [],
      createdAt: now,
      updatedAt: now,
    });

    store.clear();
    expect(store.list()).toHaveLength(0);
  });
});

// ── TaskManager: CRUD ──────────────────────────────────────────────────

describe('TaskManager: CRUD', () => {
  it('creates a task with pending status', async () => {
    const manager = makeManager();
    const task = await manager.create(makeRequest({ prompt: 'list files' }));

    expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(task.prompt).toBe('list files');
    expect(task.status).toBe('pending');
    expect(task.mode).toBe('code');
    expect(task.capabilities).toEqual([]);
  });

  it('creates a task with explicit mode and capabilities', async () => {
    const manager = makeManager();
    const task = await manager.create(
      makeRequest({
        prompt: 'browse the web',
        mode: 'browser',
        capabilities: ['browser.cdp'],
      })
    );

    expect(task.mode).toBe('browser');
    expect(task.capabilities).toEqual(['browser.cdp']);
  });

  it('creates a task with userId', async () => {
    const manager = makeManager();
    const task = await manager.create(makeRequest({ userId: 42 }));

    expect(task.userId).toBe(42);
  });

  it('calls onTaskCreated callback', async () => {
    const onTaskCreated = vi.fn();
    const manager = makeManager({ onTaskCreated });

    await manager.create(makeRequest({ prompt: 'test' }));

    expect(onTaskCreated).toHaveBeenCalledTimes(1);
    expect(onTaskCreated.mock.calls[0][0].prompt).toBe('test');
  });

  it('gets a task by ID', async () => {
    const manager = makeManager();
    const created = await manager.create(makeRequest());

    const retrieved = manager.get(created.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
  });

  it('lists tasks', async () => {
    const manager = makeManager();
    await manager.create(makeRequest({ prompt: 'task 1' }));
    await manager.create(makeRequest({ prompt: 'task 2' }));

    const list = manager.list();
    expect(list).toHaveLength(2);
  });

  it('lists tasks filtered by userId', async () => {
    const manager = makeManager();
    await manager.create(makeRequest({ userId: 1, prompt: 'user1' }));
    await manager.create(makeRequest({ userId: 2, prompt: 'user2' }));

    const user1Tasks = manager.list(1);
    expect(user1Tasks).toHaveLength(1);
    expect(user1Tasks[0].prompt).toBe('user1');
  });

  it('deletes a task', async () => {
    const manager = makeManager();
    const task = await manager.create(makeRequest());

    expect(manager.delete(task.id)).toBe(true);
    expect(manager.get(task.id)).toBeUndefined();
  });
});

// ── TaskManager: Lifecycle ─────────────────────────────────────────────

describe('TaskManager: Lifecycle', () => {
  it('approves and runs a task', async () => {
    const manager = makeManager();
    const task = await manager.create(makeRequest({ prompt: 'read file' }));
    const result = await manager.approve(task.id);

    expect(result.status).toBe('completed');
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it('throws if task not found on approve', async () => {
    const manager = makeManager();

    await expect(manager.approve('nonexistent')).rejects.toThrow('Task not found');
  });

  it('throws if task is not pending on approve', async () => {
    const manager = makeManager();
    const task = await manager.create(makeRequest());

    const t = manager.get(task.id)!;
    t.status = 'completed';

    await expect(manager.approve(task.id)).rejects.toThrow('cannot be approved');
  });

  it('aborts a running task', async () => {
    const onTaskUpdate = vi.fn();
    const manager = makeManager({ onTaskUpdate });
    const task = await manager.create(makeRequest());

    const t = manager.get(task.id)!;
    t.status = 'running';

    const result = manager.abort(task.id);

    expect(result.status).toBe('cancelled');
    expect(onTaskUpdate).toHaveBeenCalled();
  });

  it('throws if task not found on abort', () => {
    const store = new TaskStore();
    const manager = new TaskManager(store, makeOpts());

    expect(() => manager.abort('nonexistent')).toThrow();
  });

  it('throws if task is not running on abort', async () => {
    const store = new TaskStore();
    const manager = new TaskManager(store, makeOpts());
    const task = await manager.create(makeRequest());

    expect(() => manager.abort(task.id)).toThrow();
  });

  it('resumes a completed task', async () => {
    const manager = makeManager();

    const task = await manager.create(makeRequest({ prompt: 'initial task' }));
    const completed = await manager.approve(task.id);

    expect(completed.status).toBe('completed');

    const resumed = await manager.resume(task.id, 'follow-up question');

    expect(resumed.status).toBe('completed');
    expect(resumed.prompt).toContain('follow-up question');
  });

  it('throws if task not found on resume', async () => {
    const manager = makeManager();

    await expect(manager.resume('nonexistent', 'msg')).rejects.toThrow('Task not found');
  });

  it('throws if task is not completed on resume', async () => {
    const manager = makeManager();
    const task = await manager.create(makeRequest());

    await expect(manager.resume(task.id, 'msg')).rejects.toThrow('cannot be resumed');
  });

  it('calls onTaskUpdate during approval', async () => {
    const onTaskUpdate = vi.fn();
    const manager = makeManager({ onTaskUpdate });

    const task = await manager.create(makeRequest());
    await manager.approve(task.id);

    expect(onTaskUpdate).toHaveBeenCalled();
  });

  it('uses custom loop setup', async () => {
    const customSetup: LoopSetupFn = vi.fn().mockReturnValue({
      actionExecutors: { 'custom.action': async () => 'custom result' },
      systemPrompt: 'Custom prompt',
      initialHistory: [{ role: 'user', content: 'hello' }],
    });

    const manager = makeManager({
      loopRegistry: makeLoopRegistry(customSetup),
    });

    const task = await manager.create(
      makeRequest({
        prompt: 'do custom thing',
      })
    );

    await manager.approve(task.id);

    expect(customSetup).toHaveBeenCalled();
    expect(manager.get(task.id)).toBeDefined();
  });
});

describe('TaskManager: graceful shutdown', () => {
  it('markShuttingDown cancels running tasks and returns count', async () => {
    const manager = makeManager();
    const task = await manager.create(makeRequest());
    manager.get(task.id)!.status = 'running';

    const n = manager.markShuttingDown();

    expect(n).toBe(1);
    expect(manager.get(task.id)!.status).toBe('cancelled');
    expect(manager.get(task.id)!.error).toBe('Server shutting down');
  });

  it('create rejects after markShuttingDown', async () => {
    const manager = makeManager();
    manager.markShuttingDown();
    await expect(manager.create(makeRequest())).rejects.toThrow('Server is shutting down');
  });

  it('approve rejects after markShuttingDown', async () => {
    const manager = makeManager();
    const task = await manager.create(makeRequest());
    manager.markShuttingDown();
    await expect(manager.approve(task.id)).rejects.toThrow('Server is shutting down');
  });

  it('waitForAllTasks resolves when no work is in flight', async () => {
    const manager = makeManager();
    const ok = await manager.waitForAllTasks(1000);
    expect(ok).toBe(true);
  });

  it('waitForAllTasks waits for running approval', async () => {
    vi.mocked(providerDispatch.dispatchChat).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(JSON.stringify({ type: 'done', summary: 'ok' })), 200))
    );
    const manager = makeManager();
    const task = await manager.create(makeRequest());
    const p = manager.approve(task.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(manager.getActiveTaskCount()).toBe(1);
    const done = await manager.waitForAllTasks(5000);
    expect(done).toBe(true);
    await p;
  });

  it('destroyAll cancels tasks still marked running', async () => {
    const manager = makeManager();
    const task = await manager.create(makeRequest());
    manager.get(task.id)!.status = 'running';

    manager.destroyAll();

    expect(manager.get(task.id)!.status).toBe('cancelled');
    expect(manager.get(task.id)!.error).toBe('App shutting down');
  });
});

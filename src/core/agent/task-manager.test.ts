import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../types';
import { TaskManager } from './task-manager';

// Mock heavy deps
vi.mock('../stores/skill-store', () => ({
  loadSkills: vi.fn(async () => []),
  getActiveSkillPrompts: vi.fn(() => ''),
}));
vi.mock('./task-memory', () => ({
  searchMemories: vi.fn(() => []),
  formatMemoriesForPrompt: vi.fn(() => ''),
  searchFacts: vi.fn(() => []),
  formatFactsForPrompt: vi.fn(() => ''),
  saveMemory: vi.fn(),
  closeMemoryDb: vi.fn(),
}));
vi.mock('../config', () => ({
  getDataDir: vi.fn(() => '/tmp/skynul-test'),
}));
vi.mock('../../ws/events', () => ({
  broadcast: vi.fn(),
}));
vi.mock('../browser/session-mode', () => ({
  isPerTaskBrowserSessionMode: vi.fn(() => false),
  parseBrowserSessionMode: vi.fn(() => 'shared'),
}));

// Prevent actual disk I/O in tests
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {
    throw new Error('no file');
  }),
}));
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe('TaskManager.waitForTasks', () => {
  let tm: TaskManager;

  beforeEach(() => {
    tm = new TaskManager();
  });

  it('resolves immediately for already-completed tasks', async () => {
    const task = tm.create({ prompt: 'test', mode: 'code' });
    // Manually set to completed
    (task as any).status = 'completed';
    task.summary = 'Done';
    (tm as any).tasks.set(task.id, task);

    const results = await tm.waitForTasks([task.id], 1000);
    expect(results).toHaveLength(1);
    expect(results[0]?.taskId).toBe(task.id);
    expect(results[0]?.status).toBe('completed');
    expect(results[0]?.summary).toBe('Done');
  });

  it('resolves immediately for already-failed tasks', async () => {
    const task = tm.create({ prompt: 'test', mode: 'code' });
    (task as any).status = 'failed';
    task.error = 'something broke';
    (tm as any).tasks.set(task.id, task);

    const results = await tm.waitForTasks([task.id], 1000);
    expect(results[0]?.status).toBe('failed');
    expect(results[0]?.error).toBe('something broke');
  });

  it('resolves immediately for already-cancelled tasks', async () => {
    const task = tm.create({ prompt: 'test', mode: 'code' });
    (task as any).status = 'cancelled';
    (tm as any).tasks.set(task.id, task);

    const results = await tm.waitForTasks([task.id], 1000);
    expect(results[0]?.status).toBe('cancelled');
  });

  it('returns failed result for unknown task ids', async () => {
    const results = await tm.waitForTasks(['task_nonexistent'], 1000);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('failed');
    expect(results[0]?.error).toMatch(/not found/);
  });

  it('resolves when taskUpdate event fires with terminal status', async () => {
    const task = tm.create({ prompt: 'running task', mode: 'code' });
    (task as any).status = 'running';
    (tm as any).tasks.set(task.id, task);

    // Emit update after a short delay
    setTimeout(() => {
      const updated: Task = { ...task, status: 'completed', summary: 'finished' };
      tm.emit('taskUpdate', updated);
    }, 20);

    const results = await tm.waitForTasks([task.id], 2000);
    expect(results[0]?.status).toBe('completed');
    expect(results[0]?.summary).toBe('finished');
  });

  it('times out and returns failed when task does not finish', async () => {
    const task = tm.create({ prompt: 'slow task', mode: 'code' });
    (task as any).status = 'running';
    (tm as any).tasks.set(task.id, task);

    const results = await tm.waitForTasks([task.id], 50); // 50ms timeout
    expect(results[0]?.status).toBe('failed');
    expect(results[0]?.error).toMatch(/timed out/);
  });

  it('waits for multiple tasks in parallel', async () => {
    const t1 = tm.create({ prompt: 'task 1', mode: 'code' });
    const t2 = tm.create({ prompt: 'task 2', mode: 'code' });
    (t1 as any).status = 'running';
    (t2 as any).status = 'running';
    (tm as any).tasks.set(t1.id, t1);
    (tm as any).tasks.set(t2.id, t2);

    setTimeout(() => {
      tm.emit('taskUpdate', { ...t1, status: 'completed', summary: 'result 1' });
      tm.emit('taskUpdate', { ...t2, status: 'failed', error: 'error 2' });
    }, 20);

    const results = await tm.waitForTasks([t1.id, t2.id], 2000);
    expect(results).toHaveLength(2);
    const r1 = results.find((r) => r.taskId === t1.id);
    const r2 = results.find((r) => r.taskId === t2.id);
    expect(r1?.status).toBe('completed');
    expect(r2?.status).toBe('failed');
  });
});

describe('TaskManager.spawnTask', () => {
  let tm: TaskManager;

  beforeEach(() => {
    tm = new TaskManager();
    // Prevent approve from actually running a runner
    vi.spyOn(tm, 'approve').mockResolvedValue({} as Task);
  });

  it('creates a child task and returns its id immediately', async () => {
    const parent = tm.create({ prompt: 'parent', mode: 'code' });
    const result = await tm.spawnTask('do research', parent.id, {
      mode: 'browser',
      agentRole: 'Research',
    });

    expect(result.taskId).toBeDefined();
    expect(result.taskId).toMatch(/^task_/);
    const child = tm.get(result.taskId);
    expect(child?.parentTaskId).toBe(parent.id);
    expect(child?.agentRole).toBe('Research');
    expect(child?.mode).toBe('browser');
  });

  it('auto-approves the child task', async () => {
    const parent = tm.create({ prompt: 'parent', mode: 'code' });
    const result = await tm.spawnTask('do research', parent.id);
    expect(tm.approve).toHaveBeenCalledWith(result.taskId);
  });

  it('inherits capabilities from parent when not specified', async () => {
    const parent = tm.create({ prompt: 'parent', mode: 'browser', capabilities: ['browser.cdp'] });
    const result = await tm.spawnTask('subtask', parent.id);
    const child = tm.get(result.taskId);
    expect(child?.capabilities).toEqual(['browser.cdp']);
  });

  it('uses provided capabilities over parent capabilities', async () => {
    const parent = tm.create({ prompt: 'parent', mode: 'browser', capabilities: ['browser.cdp'] });
    const result = await tm.spawnTask('subtask', parent.id, { capabilities: [] });
    const child = tm.get(result.taskId);
    expect(child?.capabilities).toEqual([]);
  });

  it('passes maxSteps to child when specified', async () => {
    const parent = tm.create({ prompt: 'parent', mode: 'code' });
    const result = await tm.spawnTask('research', parent.id, { maxSteps: 30 });
    const child = tm.get(result.taskId);
    expect(child?.maxSteps).toBe(30);
  });

  it('uses DEFAULT_MAX_STEPS when maxSteps not specified', async () => {
    const parent = tm.create({ prompt: 'parent', mode: 'code' });
    const result = await tm.spawnTask('research', parent.id);
    const child = tm.get(result.taskId);
    expect(child?.maxSteps).toBe(200); // DEFAULT_MAX_STEPS
  });

  it('passes model override to child when specified', async () => {
    const parent = tm.create({ prompt: 'parent', mode: 'code' });
    const result = await tm.spawnTask('research', parent.id, { model: 'gpt-4.1-mini' });
    const child = tm.get(result.taskId);
    expect(child?.model).toBe('gpt-4.1-mini');
  });

  it('sets skipMemory=true for orchestrator children', async () => {
    const parent = tm.create({ prompt: 'parent', mode: 'code' });
    const result = await tm.spawnTask('research', parent.id);
    const child = tm.get(result.taskId);
    expect(child?.skipMemory).toBe(true);
  });
});

describe('TaskManager.approve - skipMemory', () => {
  let tm: TaskManager;

  beforeEach(() => {
    tm = new TaskManager();
  });

  it('skips memory injection when skipMemory=true', async () => {
    const { searchMemories } = await import('./task-memory');
    const searchSpy = vi.mocked(searchMemories);
    searchSpy.mockClear();

    const task = tm.create({ prompt: 'test', mode: 'code', skipMemory: true });

    // Mock the runner to prevent actual execution
    vi.spyOn(tm as any, 'runners', 'get').mockReturnValue(new Map());
    // Mock TaskRunner to avoid actual execution
    const { TaskRunner } = await import('./task-runner');
    vi.spyOn(TaskRunner.prototype, 'run').mockResolvedValue({ ...task, status: 'completed' } as any);

    await tm.approve(task.id);
    expect(searchSpy).not.toHaveBeenCalled();
  });
});

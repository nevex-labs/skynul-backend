import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../types';
import { handleCommand } from './command-router';

function makeTask(id: string, status: Task['status'] = 'running', prompt = 'test prompt'): Task {
  return {
    id,
    status,
    prompt,
    mode: 'browser',
    runner: 'browser',
    capabilities: [],
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    maxSteps: 10,
    timeoutMs: 300_000,
  };
}

const LIST_RESPONSE = '\u{1f4cb} *Tus tareas:*';
const STATUS_RESPONSE = '\u{1f680} *Tarea en marcha*';
const NOT_FOUND = '\u{1f50d} Tarea no encontrada.';
const CANCELLED = '\u26d4 Tarea cancelada.';

describe('handleCommand', () => {
  it('returns /list with tasks', async () => {
    const tm = { list: vi.fn(() => [makeTask('t1'), makeTask('t2')]) } as any;
    const result = await handleCommand('/list', tm);
    expect(result.handled).toBe(true);
    expect(result.text).toContain(LIST_RESPONSE);
    expect(tm.list).toHaveBeenCalled();
  });

  it('returns /list with empty tasks', async () => {
    const tm = { list: vi.fn(() => []) } as any;
    const result = await handleCommand('/list', tm);
    expect(result.handled).toBe(true);
    expect(result.text).toBe('\u{1f4ed} No hay tareas.');
  });

  it('/list with trailing spaces', async () => {
    const tm = { list: vi.fn(() => []) } as any;
    const result = await handleCommand('/list  ', tm);
    expect(result.handled).toBe(true);
  });

  it('returns /status for existing task', async () => {
    const task = makeTask('task-123');
    const tm = { get: vi.fn(() => task) } as any;
    const result = await handleCommand('/status task-123', tm);
    expect(result.handled).toBe(true);
    expect(result.text).toContain(STATUS_RESPONSE);
    expect(tm.get).toHaveBeenCalledWith('task-123');
  });

  it('returns not-found for /status with unknown id', async () => {
    const tm = { get: vi.fn(() => undefined) } as any;
    const result = await handleCommand('/status unknown-id', tm);
    expect(result.handled).toBe(true);
    expect(result.text).toBe(NOT_FOUND);
  });

  it('uses resolveTask hook for /status (1-based index)', async () => {
    const task = makeTask('real-id');
    const resolveTask = vi.fn((input: string) => {
      const num = Number.parseInt(input, 10);
      if (!isNaN(num) && num > 0) {
        return makeTask('real-id');
      }
      return undefined;
    });
    const tm = { get: vi.fn(() => task) } as any;
    const result = await handleCommand('/status 1', tm, { resolveTask });
    expect(result.handled).toBe(true);
    expect(resolveTask).toHaveBeenCalledWith('1');
    expect(tm.get).not.toHaveBeenCalled();
  });

  it('returns /cancel for existing task', async () => {
    const task = makeTask('task-456');
    const tm = { get: vi.fn(() => task), cancel: vi.fn() } as any;
    const result = await handleCommand('/cancel task-456', tm);
    expect(result.handled).toBe(true);
    expect(result.text).toBe(CANCELLED);
    expect(tm.cancel).toHaveBeenCalledWith('task-456');
  });

  it('returns not-found for /cancel with unknown id', async () => {
    const tm = { get: vi.fn(() => undefined), cancel: vi.fn() } as any;
    const result = await handleCommand('/cancel unknown-id', tm);
    expect(result.handled).toBe(true);
    expect(result.text).toBe(NOT_FOUND);
    expect(tm.cancel).not.toHaveBeenCalled();
  });

  it('returns error text when cancel throws', async () => {
    const task = makeTask('task-789', 'completed');
    const tm = {
      get: vi.fn(() => task),
      cancel: vi.fn(() => {
        throw new Error('Cannot cancel completed task');
      }),
    } as any;
    const result = await handleCommand('/cancel task-789', tm);
    expect(result.handled).toBe(true);
    expect(result.text).toBe('Error: Cannot cancel completed task');
  });

  it('/cancel with resolveTask hook', async () => {
    const task = makeTask('real-id');
    const resolveTask = vi.fn(() => task);
    const tm = { cancel: vi.fn() } as any;
    const result = await handleCommand('/cancel 1', tm, { resolveTask });
    expect(result.handled).toBe(true);
    expect(result.text).toBe(CANCELLED);
    expect(resolveTask).toHaveBeenCalledWith('1');
  });

  it('/unpair returns __UNPAIR__ sentinel', async () => {
    const tm = {} as any;
    const result = await handleCommand('/unpair', tm);
    expect(result.handled).toBe(true);
    expect(result.text).toBe('__UNPAIR__');
  });

  it('/unpair with arguments still matches', async () => {
    const tm = {} as any;
    const result = await handleCommand('/unpair extra-args', tm);
    expect(result.handled).toBe(true);
    expect(result.text).toBe('__UNPAIR__');
  });

  it('plain text falls through', async () => {
    const tm = {} as any;
    const result = await handleCommand('create me a task', tm);
    expect(result.handled).toBe(false);
    expect(result.text).toBe('');
  });

  it('text starting with / but unknown command falls through', async () => {
    const tm = {} as any;
    const result = await handleCommand('/unknown arg', tm);
    expect(result.handled).toBe(false);
  });

  it('/status with no argument falls through', async () => {
    const tm = {} as any;
    const result = await handleCommand('/status', tm);
    expect(result.handled).toBe(false);
  });

  it('/cancel with no argument falls through', async () => {
    const tm = {} as any;
    const result = await handleCommand('/cancel', tm);
    expect(result.handled).toBe(false);
  });

  it('whitespace-only input falls through', async () => {
    const tm = {} as any;
    const result = await handleCommand('   ', tm);
    expect(result.handled).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { Task } from '../../types';
import {
  formatStepUpdate,
  formatTaskComplete,
  formatTaskFailed,
  formatTaskList,
  formatTaskSummary,
} from './message-formatter';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    status: 'running',
    prompt: 'test prompt',
    mode: 'browser',
    runner: 'browser',
    capabilities: [],
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    maxSteps: 10,
    timeoutMs: 300_000,
    ...overrides,
  };
}

describe('formatTaskSummary', () => {
  it('formats running task with header', () => {
    const task = makeTask({ status: 'running' });
    const result = formatTaskSummary(task);
    expect(result).toContain('\u{1f680} *Tarea en marcha*');
    expect(result).toContain('test prompt');
    expect(result).toContain('Estado: En curso');
  });

  it('formats completed task', () => {
    const task = makeTask({ status: 'completed' });
    const result = formatTaskSummary(task);
    expect(result).toContain('\u2705 *Tarea completada*');
    expect(result).toContain('Estado: Completada');
  });

  it('formats failed task', () => {
    const task = makeTask({ status: 'failed' });
    const result = formatTaskSummary(task);
    expect(result).toContain('\u26a0\ufe0f *Tarea fallida*');
    expect(result).toContain('Estado: Falló');
  });

  it('formats cancelled task', () => {
    const task = makeTask({ status: 'cancelled' });
    const result = formatTaskSummary(task);
    expect(result).toContain('\u26d4 *Tarea cancelada*');
    expect(result).toContain('Estado: Cancelada');
  });

  it('formats monitoring task', () => {
    const task = makeTask({ status: 'monitoring' });
    const result = formatTaskSummary(task);
    expect(result).toContain('\u{1f440} *Monitoreando*');
    expect(result).toContain('Estado: Monitoreando');
  });

  it('includes summary when present', () => {
    const task = makeTask({ status: 'completed', summary: 'Done. 🔗 https://example.com/result' });
    const result = formatTaskSummary(task);
    expect(result).toContain('[Ver acá](https://example.com/result)');
  });

  it('does not include summary line when absent', () => {
    const task = makeTask({ summary: undefined });
    const result = formatTaskSummary(task);
    expect(result).not.toContain('summary');
  });

  it('truncates long prompts', () => {
    const longPrompt = 'A'.repeat(200);
    const task = makeTask({ prompt: longPrompt });
    const result = formatTaskSummary(task);
    expect(result.length).toBeLessThan(longPrompt.length + 30);
    expect(result).toContain('\u2026');
  });

  it('linkifies bare URLs in summary', () => {
    const task = makeTask({ summary: 'See https://example.com/page for details' });
    const result = formatTaskSummary(task);
    expect(result).toContain('[Link](https://example.com/page)');
  });

  it('does not double-linkify URLs already wrapped', () => {
    const task = makeTask({ summary: '[Click](https://example.com)' });
    const result = formatTaskSummary(task);
    expect(result).toContain('[Click](https://example.com)');
  });

  it('handles unknown status gracefully', () => {
    const task = makeTask({ status: 'pending_approval' as Task['status'] });
    const result = formatTaskSummary(task);
    expect(result).toContain('Estado: Pendiente');
  });
});

describe('formatStepUpdate', () => {
  it('formats step with count', () => {
    const task = makeTask({
      steps: [{ index: 0, timestamp: Date.now(), screenshotBase64: '', action: { type: 'wait', ms: 1000 } }],
      maxSteps: 10,
    });
    const result = formatStepUpdate(task);
    expect(result).toContain('Trabajando... (paso 1/10)');
  });

  it('includes thought when present', () => {
    const task = makeTask({
      steps: [
        {
          index: 0,
          timestamp: Date.now(),
          screenshotBase64: '',
          action: { type: 'wait', ms: 1000 },
          thought: 'Analyzing the page',
        },
      ],
    });
    const result = formatStepUpdate(task);
    expect(result).toContain('Analyzing the page');
  });

  it('truncates long thoughts', () => {
    const longThought = 'Thinking '.repeat(50);
    const task = makeTask({
      steps: [
        {
          index: 0,
          timestamp: Date.now(),
          screenshotBase64: '',
          action: { type: 'wait', ms: 1000 },
          thought: longThought,
        },
      ],
    });
    const result = formatStepUpdate(task);
    expect(result).toContain('\u2026');
  });

  it('handles empty steps array', () => {
    const task = makeTask({ steps: [] });
    const result = formatStepUpdate(task);
    expect(result).toContain('paso 0/');
  });
});

describe('formatTaskComplete', () => {
  it('returns summary with linkified URLs', () => {
    const task = makeTask({ summary: 'Done. 🔗 https://example.com' });
    const result = formatTaskComplete(task);
    expect(result).toContain('[Ver acá](https://example.com)');
  });

  it('returns fallback when no summary', () => {
    const task = makeTask({ summary: undefined });
    const result = formatTaskComplete(task);
    expect(result).toBe('Listo, terminé.');
  });
});

describe('formatTaskFailed', () => {
  it('returns error message truncated', () => {
    const task = makeTask({ error: 'Something went wrong' });
    const result = formatTaskFailed(task);
    expect(result).toBe('No pude completarlo: Something went wrong');
  });

  it('truncates long errors', () => {
    const longError = 'E'.repeat(300);
    const task = makeTask({ error: longError });
    const result = formatTaskFailed(task);
    expect(result).toContain('\u2026');
    expect(result.length).toBeLessThan(300);
  });

  it('returns cancelled message for cancelled status', () => {
    const task = makeTask({ status: 'cancelled' });
    const result = formatTaskFailed(task);
    expect(result).toBe('Cancelado.');
  });

  it('returns generic failure when no error', () => {
    const task = makeTask({ error: undefined });
    const result = formatTaskFailed(task);
    expect(result).toBe('No pude completar la tarea.');
  });
});

describe('formatTaskList', () => {
  it('returns empty message for no tasks', () => {
    const result = formatTaskList([]);
    expect(result).toBe('\u{1f4ed} No hay tareas.');
  });

  it('formats list of tasks', () => {
    const tasks = [
      makeTask({ id: 't1', prompt: 'Task one', status: 'running' }),
      makeTask({ id: 't2', prompt: 'Task two', status: 'completed' }),
    ];
    const result = formatTaskList(tasks);
    expect(result).toContain('\u{1f4cb} *Tus tareas:*');
    expect(result).toContain('1. Task one');
    expect(result).toContain('En curso');
    expect(result).toContain('2. Task two');
    expect(result).toContain('Completada');
  });

  it('truncates prompts to 60 chars', () => {
    const longPrompt = 'P'.repeat(100);
    const tasks = [makeTask({ prompt: longPrompt })];
    const result = formatTaskList(tasks);
    expect(result).toContain('\u2026');
  });

  it('limits to 10 tasks with overflow message', () => {
    const tasks = Array.from({ length: 15 }, (_, i) => makeTask({ id: `t${i}`, prompt: `Task ${i}` }));
    const result = formatTaskList(tasks);
    expect(result).toContain('...y 5 más');
    expect(result).not.toContain('11.');
  });

  it('formats dates in es-AR locale', () => {
    const tasks = [makeTask({ createdAt: new Date('2025-06-15T14:30:00').getTime() })];
    const result = formatTaskList(tasks);
    expect(result).toContain('15 jun');
  });
});

/**
 * Shared command router for messaging channels.
 *
 * Handles /list, /cancel <id>, /status <id>, /unpair.
 * Text without / prefix returns { handled: false } for fallthrough to task creation.
 *
 * Usage in channels:
 *   const result = await handleCommand(content, this.taskManager, opts);
 *   if (result.handled) {
 *     if (result.text === '__UNPAIR__') { await this.unpair(); }
 *     else { await reply(result.text); }
 *     return;
 *   }
 *   // create task...
 */

import type { Task } from '../../types';
import type { TaskManager } from '../agent/task-manager';
import { formatTaskList, formatTaskSummary } from './message-formatter';

export type HandleCommandOptions = {
  resolveTask?: (input: string) => Task | undefined;
};

const NOT_FOUND = '\u{1f50d} Tarea no encontrada.';

function resolveTaskRef(raw: string, taskManager: TaskManager, opts?: HandleCommandOptions): Task | undefined {
  return opts?.resolveTask ? opts.resolveTask(raw) : taskManager.get(raw);
}

function handleList(taskManager: TaskManager): { handled: boolean; text: string } {
  return { handled: true, text: formatTaskList(taskManager.list()) };
}

function handleStatus(
  text: string,
  taskManager: TaskManager,
  opts?: HandleCommandOptions
): { handled: boolean; text: string } {
  const task = resolveTaskRef(text.slice(8).trim(), taskManager, opts);
  if (!task) return { handled: true, text: NOT_FOUND };
  return { handled: true, text: formatTaskSummary(task) };
}

function handleCancel(
  text: string,
  taskManager: TaskManager,
  opts?: HandleCommandOptions
): { handled: boolean; text: string } {
  const task = resolveTaskRef(text.slice(8).trim(), taskManager, opts);
  if (!task) return { handled: true, text: NOT_FOUND };
  try {
    taskManager.cancel(task.id);
    return { handled: true, text: '\u26d4 Tarea cancelada.' };
  } catch (e) {
    return { handled: true, text: `Error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function handleCommand(
  body: string,
  taskManager: TaskManager,
  opts?: HandleCommandOptions
): Promise<{ handled: boolean; text: string }> {
  const text = body.trim();
  if (text === '/list') return handleList(taskManager);
  if (text.startsWith('/status ')) return handleStatus(text, taskManager, opts);
  if (text.startsWith('/cancel ')) return handleCancel(text, taskManager, opts);
  if (text.startsWith('/unpair')) return { handled: true, text: '__UNPAIR__' };
  return { handled: false, text: '' };
}

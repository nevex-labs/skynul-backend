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

export async function handleCommand(
  body: string,
  taskManager: TaskManager,
  opts?: HandleCommandOptions
): Promise<{ handled: boolean; text: string }> {
  const text = body.trim();

  if (text === '/list') {
    const tasks = taskManager.list();
    return { handled: true, text: formatTaskList(tasks) };
  }

  if (text.startsWith('/status ')) {
    const raw = text.slice(8).trim();
    const task = opts?.resolveTask ? opts.resolveTask(raw) : taskManager.get(raw);
    if (!task) return { handled: true, text: '\u{1f50d} Tarea no encontrada.' };
    return { handled: true, text: formatTaskSummary(task) };
  }

  if (text.startsWith('/cancel ')) {
    const raw = text.slice(8).trim();
    const task = opts?.resolveTask ? opts.resolveTask(raw) : taskManager.get(raw);
    if (!task) return { handled: true, text: '\u{1f50d} Tarea no encontrada.' };
    try {
      taskManager.cancel(task.id);
      return { handled: true, text: '\u26d4 Tarea cancelada.' };
    } catch (e) {
      return { handled: true, text: `Error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  if (text.startsWith('/unpair')) {
    return { handled: true, text: '__UNPAIR__' };
  }

  return { handled: false, text: '' };
}

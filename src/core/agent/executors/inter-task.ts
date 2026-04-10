import type { TaskAction } from '../../../types';
import type { ExecutorContext, ExecutorResult } from './index';

export async function executeInterTaskAction(
  ctx: ExecutorContext,
  action: Extract<TaskAction, { type: 'task_list_peers' | 'task_send' | 'task_read' | 'task_message' }>
): Promise<ExecutorResult> {
  const tm = ctx.taskManager as {
    list(): import('../../../types').Task[];
    get(id: string): import('../../../types').Task | undefined;
    sendMessage(taskId: string, fromTaskId: string, message: string): void;
    spawnAndWait(
      prompt: string,
      capabilities: string[],
      parentTaskId?: string,
      agentIdentity?: { agentName?: string; agentRole?: string }
    ): Promise<{ taskId: string; status: string; output: string }>;
  } | null;
  if (!tm) return { ok: false, error: 'task manager not available for inter-task communication' };

  switch (action.type) {
    case 'task_list_peers': {
      const all = tm.list();
      const peers = all
        .filter((t) => t.id !== ctx.task.id)
        .map((t) => ({ id: t.id, prompt: t.prompt.slice(0, 120), status: t.status }));
      return { ok: true, value: JSON.stringify(peers) };
    }
    case 'task_send': {
      const res = await tm.spawnAndWait(action.prompt, ctx.task.capabilities, ctx.task.id, {
        agentName: action.agentName,
        agentRole: action.agentRole,
      });
      return { ok: true, value: `Sub-task ${res.taskId} ${res.status}: ${res.output}` };
    }
    case 'task_read': {
      const target = tm.get(action.taskId);
      if (!target) return { ok: false, error: `task ${action.taskId} not found` };
      return {
        ok: true,
        value: JSON.stringify({ id: target.id, status: target.status, summary: target.summary ?? null }),
      };
    }
    case 'task_message': {
      try {
        tm.sendMessage(action.taskId, ctx.task.id, action.message);
        return { ok: true, value: `Message sent to ${action.taskId}` };
      } catch (e) {
        return { ok: false, error: String(e instanceof Error ? e.message : e) };
      }
    }
  }
}

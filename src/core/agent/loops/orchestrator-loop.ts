/**
 * Orchestrator mode — plans complex tasks and delegates to specialized sub-agents.
 * Does NOT execute browser/code/cdp actions directly.
 */

import type { OrchestratorPlan, Task, TaskAction } from '../../../types';
import type { VisionMessage } from '../../../types';
import {
  type ExecutorContext,
  executeFactAction,
  executeInterTaskAction,
  executeMemoryAction,
} from '../action-executors';
import { buildOrchestratorSystemPrompt } from '../system-prompt';
import type { TaskManager } from '../task-manager';
import type { LoopCallbacks } from './agent-loop';

export type OrchestratorLoopSetup = {
  deps: {
    task: Task;
    memoryContext?: string;
    taskManager: TaskManager | null;
    maxSteps: number;
    paperMode?: boolean;
  };
  onStatus: (msg: string) => void;
  onUpdate: (task: Task) => void;
  isAborted: () => boolean;
};

export function setupOrchestratorLoop(setup: OrchestratorLoopSetup): {
  systemPrompt: string;
  systemPromptCompact: string;
  history: VisionMessage[];
  callbacks: LoopCallbacks;
} {
  const { task, memoryContext, taskManager, paperMode } = setup.deps;
  const memCtx = memoryContext ?? '';

  const systemPrompt = buildOrchestratorSystemPrompt(task.capabilities, memCtx, false, !!paperMode);
  const systemPromptCompact = buildOrchestratorSystemPrompt(task.capabilities, memCtx, true, !!paperMode);

  const initialText = `Task: ${task.prompt}${memCtx ? `\n\n${memCtx}` : ''}

[ORCHESTRATOR MODE] Assess the task complexity. For simple tasks, spawn agents directly. For complex tasks (3+ subtasks, dependencies), plan first. Use task_spawn_batch for independent parallel work. Call \`done\` with a final summary when complete.`;

  const history: VisionMessage[] = [
    {
      role: 'user',
      content: [{ type: 'input_text', text: initialText }],
    },
  ];

  const callbacks: LoopCallbacks = {
    taskManager,

    buildTurnMessage(stepIndex, _budget) {
      if (stepIndex === 0) {
        return { text: initialText };
        // no images — orchestrator is text-only
      }

      // Build child task status block
      const childIds = task.childTaskIds ?? [];
      let childStatus = '';
      if (childIds.length > 0 && taskManager) {
        const statusLines = childIds.map((id) => {
          const child = taskManager.get(id);
          if (!child) return `- ${id}: not found`;
          const summary = child.summary ? ` — ${child.summary.slice(0, 200)}` : '';
          const error = child.error ? ` [error: ${child.error.slice(0, 100)}]` : '';
          return `- ${id} (${child.agentRole ?? 'agent'}): ${child.status}${summary}${error}`;
        });
        childStatus = `\n\n## Child Task Status:\n${statusLines.join('\n')}`;
      }

      // Drain inbox messages
      const messages = taskManager?.drainMessages(task.id) ?? [];
      let inboxBlock = '';
      if (messages.length > 0) {
        const msgLines = messages.map((m) => `From ${m.from}: ${m.message}`).join('\n');
        inboxBlock = `\n\n## Messages:\n${msgLines}`;
      }

      // Build a contextual nudge based on child task states
      const children = childIds.map((id) => taskManager?.get(id)).filter(Boolean);
      const running = children.filter((c) => c!.status === 'running').length;
      const completed = children.filter((c) => c!.status === 'completed').length;
      const failed = children.filter((c) => c!.status === 'failed').length;

      let nudge = '';
      if (running > 0 && completed === 0 && failed === 0) {
        nudge = `${running} task(s) still running. Use task_wait to join, or spawn more if needed.`;
      } else if (failed > 0 && completed === 0) {
        nudge = `${failed} task(s) failed. Assess errors — retry with adjusted params or fail.`;
      } else if (running === 0 && childIds.length > 0) {
        nudge = `All ${childIds.length} child task(s) finished (${completed} ok, ${failed} failed). Read results and proceed to done.`;
      } else {
        nudge = 'Decide your next action.';
      }

      return {
        text: `Step ${stepIndex + 1}.${childStatus}${inboxBlock}\n\n${nudge}`,
        // no images
      };
    },

    executeAction(_action) {
      throw new Error('executeAction must be provided by TaskRunner');
    },

    recordStep() {
      task.updatedAt = Date.now();
      setup.onUpdate(task);
    },

    pushStatus: setup.onStatus,
    isAborted: setup.isAborted,
  };

  return { systemPrompt, systemPromptCompact, history, callbacks };
}

const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** Execute an orchestrator-mode action. */
export async function executeOrchestratorAction(ctx: ExecutorContext, action: TaskAction): Promise<string> {
  const { task, taskManager, pushUpdate } = ctx;

  switch (action.type) {
    case 'plan': {
      const plan = (action as { type: 'plan'; plan: OrchestratorPlan }).plan;
      task.plan = plan;
      pushUpdate();
      return `Plan registered: ${plan.objective}. ${plan.subtasks.length} subtask(s) planned.`;
    }

    case 'task_spawn': {
      if (!taskManager) return '[Error: task manager not available]';
      const a = action as Extract<TaskAction, { type: 'task_spawn' }>;
      const { taskId } = await taskManager.spawnTask(a.prompt, task.id, {
        mode: a.mode,
        capabilities: a.capabilities,
        agentRole: a.agentRole,
        agentName: a.agentName,
        maxSteps: a.maxSteps,
        model: a.model,
      });
      if (!task.childTaskIds) task.childTaskIds = [];
      task.childTaskIds.push(taskId);
      pushUpdate();
      const child = taskManager.get(taskId);
      return `Spawned ${taskId} (${child?.agentName ?? a.agentName ?? 'agent'}, role: ${a.agentRole ?? 'agent'}). Status: running.`;
    }

    case 'task_spawn_batch': {
      if (!taskManager) return '[Error: task manager not available]';
      const a = action as Extract<TaskAction, { type: 'task_spawn_batch' }>;
      const spawnedIds: string[] = [];
      for (const t of a.tasks) {
        const { taskId } = await taskManager.spawnTask(t.prompt, task.id, {
          mode: t.mode,
          capabilities: t.capabilities,
          agentRole: t.agentRole,
          agentName: t.agentName,
          maxSteps: t.maxSteps,
          model: t.model,
        });
        spawnedIds.push(taskId);
        if (!task.childTaskIds) task.childTaskIds = [];
        task.childTaskIds.push(taskId);
      }
      pushUpdate();
      const summaries = spawnedIds.map((id) => {
        const child = taskManager.get(id);
        return `${id} (${child?.agentName ?? 'agent'}, role: ${child?.agentRole ?? 'agent'})`;
      });
      return `Spawned ${spawnedIds.length} tasks in parallel:\n${summaries.map((s) => `- ${s}`).join('\n')}\nAll running. Use task_wait to join.`;
    }

    case 'task_wait': {
      if (!taskManager) return '[Error: task manager not available]';
      const a = action as Extract<TaskAction, { type: 'task_wait' }>;
      const timeout = a.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
      const results = await taskManager.waitForTasks(a.taskIds, timeout);
      return JSON.stringify(results);
    }

    case 'task_list_peers':
    case 'task_read':
    case 'task_message': {
      const res = await executeInterTaskAction(
        ctx,
        action as Extract<TaskAction, { type: 'task_list_peers' | 'task_read' | 'task_message' }>
      );
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }

    case 'remember_fact':
    case 'forget_fact': {
      const res = await executeFactAction(
        ctx,
        action as Extract<TaskAction, { type: 'remember_fact' | 'forget_fact' }>
      );
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }

    case 'memory_save':
    case 'memory_search':
    case 'memory_context': {
      const res = await executeMemoryAction(
        ctx,
        action as Extract<TaskAction, { type: 'memory_save' | 'memory_search' | 'memory_context' }>
      );
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }

    default:
      return `[Error: action type "${(action as any).type}" is not supported in orchestrator mode]`;
  }
}

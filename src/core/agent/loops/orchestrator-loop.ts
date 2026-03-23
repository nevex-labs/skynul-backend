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
  const { task, memoryContext, taskManager } = setup.deps;
  const memCtx = memoryContext ?? '';

  const systemPrompt = buildOrchestratorSystemPrompt(task.capabilities, memCtx, false);
  const systemPromptCompact = buildOrchestratorSystemPrompt(task.capabilities, memCtx, true);

  const initialText = `Task: ${task.prompt}${memCtx ? `\n\n${memCtx}` : ''}

[ORCHESTRATOR MODE] You MUST start with a \`plan\` action. Then spawn sub-agents, wait for results, and call \`done\` with a final summary. You do NOT execute actions directly.`;

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

      return {
        text: `Step ${stepIndex + 1}.${childStatus}${inboxBlock}\n\nContinue with the next orchestration step.`,
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
      const res = executeFactAction(ctx, action as Extract<TaskAction, { type: 'remember_fact' | 'forget_fact' }>);
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }

    case 'memory_save':
    case 'memory_search':
    case 'memory_context': {
      const res = executeMemoryAction(
        ctx,
        action as Extract<TaskAction, { type: 'memory_save' | 'memory_search' | 'memory_context' }>
      );
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }

    default:
      return `[Error: action type "${(action as any).type}" is not supported in orchestrator mode]`;
  }
}

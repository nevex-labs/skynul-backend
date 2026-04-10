/**
 * Orchestrator mode — plans complex tasks and delegates to specialized sub-agents.
 * Does NOT execute browser/code/cdp actions directly.
 */

import type { OrchestratorPlan, Task, TaskAction, VisionMessage } from '../../../types';
import { buildOrchestratorSystemPrompt } from '../../prompts/orchestrator';
import {
  type ExecutorContext,
  executeFactAction,
  executeInterTaskAction,
  executeMemoryAction,
} from '../action-executors';
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

function formatChildStatus(id: string, taskManager: TaskManager): string {
  const child = taskManager.get(id);
  if (!child) return `- ${id}: not found`;
  const summary = child.summary ? ` — ${child.summary.slice(0, 200)}` : '';
  const error = child.error ? ` [error: ${child.error.slice(0, 100)}]` : '';
  return `- ${id} (${child.agentRole ?? 'agent'}): ${child.status}${summary}${error}`;
}

function buildOrchestratorTurnText(stepIndex: number, task: Task, taskManager: TaskManager | null): string {
  const childIds = task.childTaskIds ?? [];
  const childStatus =
    childIds.length > 0 && taskManager
      ? `\n\n## Child Task Status:\n${childIds.map((id) => formatChildStatus(id, taskManager)).join('\n')}`
      : '';

  const messages = taskManager?.drainMessages(task.id) ?? [];
  const inboxBlock =
    messages.length > 0 ? `\n\n## Messages:\n${messages.map((m) => `From ${m.from}: ${m.message}`).join('\n')}` : '';

  return `Step ${stepIndex + 1}.${childStatus}${inboxBlock}\n\nContinue with the next orchestration step.`;
}

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
      if (stepIndex === 0) return { text: initialText };
      return { text: buildOrchestratorTurnText(stepIndex, task, taskManager) };
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

function unwrap(res: { ok: boolean; value?: string; error?: string }): string {
  return res.ok ? (res.value ?? '') : `[Error: ${res.error}]`;
}

const ORCH_INTER_TASK = new Set(['task_list_peers', 'task_read', 'task_message']);
const ORCH_FACT_ACTIONS = new Set(['remember_fact', 'forget_fact']);
const ORCH_MEMORY_ACTIONS = new Set(['memory_save', 'memory_search', 'memory_context']);

async function handleTaskSpawn(
  ctx: ExecutorContext,
  action: Extract<TaskAction, { type: 'task_spawn' }>
): Promise<string> {
  const { task, taskManager, pushUpdate } = ctx;
  if (!taskManager) return '[Error: task manager not available]';
  const { taskId } = await taskManager.spawnTask(action.prompt, task.id, {
    mode: action.mode,
    capabilities: action.capabilities,
    agentRole: action.agentRole,
    agentName: action.agentName,
    maxSteps: action.maxSteps,
    model: action.model,
  });
  if (!task.childTaskIds) task.childTaskIds = [];
  task.childTaskIds.push(taskId);
  pushUpdate();
  const child = taskManager.get(taskId);
  return `Spawned ${taskId} (${child?.agentName ?? action.agentName ?? 'agent'}, role: ${action.agentRole ?? 'agent'}). Status: running.`;
}

/** Execute an orchestrator-mode action. */
export async function executeOrchestratorAction(ctx: ExecutorContext, action: TaskAction): Promise<string> {
  const { task, taskManager, pushUpdate } = ctx;

  if (action.type === 'plan') {
    const plan = (action as { type: 'plan'; plan: OrchestratorPlan }).plan;
    task.plan = plan;
    pushUpdate();
    return `Plan registered: ${plan.objective}. ${plan.subtasks.length} subtask(s) planned.`;
  }
  if (action.type === 'task_spawn') return handleTaskSpawn(ctx, action as Extract<TaskAction, { type: 'task_spawn' }>);
  if (action.type === 'task_wait') {
    if (!taskManager) return '[Error: task manager not available]';
    const a = action as Extract<TaskAction, { type: 'task_wait' }>;
    return JSON.stringify(await taskManager.waitForTasks(a.taskIds, a.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS));
  }
  if (ORCH_INTER_TASK.has(action.type))
    return unwrap(await executeInterTaskAction(ctx, action as Parameters<typeof executeInterTaskAction>[1]));
  if (ORCH_FACT_ACTIONS.has(action.type))
    return unwrap(await executeFactAction(ctx, action as Parameters<typeof executeFactAction>[1]));
  if (ORCH_MEMORY_ACTIONS.has(action.type))
    return unwrap(await executeMemoryAction(ctx, action as Parameters<typeof executeMemoryAction>[1]));
  return `[Error: action type "${(action as any).type}" is not supported in orchestrator mode]`;
}

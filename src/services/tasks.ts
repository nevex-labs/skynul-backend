import { inferTaskSetup } from '../core/agent/task-inference';
import { TaskManager } from '../core/agent/task-manager';
import { resolveActiveProvider } from '../core/provider-resolver';
import { dispatchChat } from '../core/providers/dispatch';
import type { Task, TaskCreateRequest, TaskListResponse } from '../types';

export const taskManager = new TaskManager();

export async function inferTaskSetupForRequest(input: {
  prompt: string;
  attachments?: string[];
  strategy?: 'auto' | 'rules' | 'llm';
}) {
  return inferTaskSetup({
    input: { prompt: input.prompt, attachments: input.attachments },
    strategy: input.strategy,
    chat: async (messages) => dispatchChat(await resolveActiveProvider(), messages),
  });
}

export function listRuntimeTasks(): TaskListResponse {
  return { tasks: taskManager.list() };
}

export function getRuntimeTask(id: string): Task | undefined {
  return taskManager.get(id);
}

type TaskBodyInput = {
  prompt: string;
  capabilities?: TaskCreateRequest['capabilities'];
  attachments?: string[];
  mode?: TaskCreateRequest['mode'];
  infer?: boolean;
  inferStrategy?: 'auto' | 'rules' | 'llm';
  maxSteps?: number;
  timeoutMs?: number;
  source?: TaskCreateRequest['source'];
  parentTaskId?: string;
  agentName?: string;
  agentRole?: string;
  orchestrate?: 'single' | 'sequential' | 'parallel' | 'conditional';
  model?: string;
  skipMemory?: boolean;
};

async function runInference(body: TaskBodyInput) {
  return inferTaskSetup({
    input: { prompt: body.prompt, attachments: body.attachments },
    strategy: body.inferStrategy,
    chat: async (messages) => dispatchChat(await resolveActiveProvider(), messages),
  });
}

async function resolveInferredSetup(body: TaskBodyInput) {
  const missingCaps = !body.capabilities?.length;
  const missingMode = body.mode === undefined;
  if (!missingCaps && !missingMode) return { mode: body.mode, capabilities: body.capabilities };
  const inferred = await runInference(body);
  return {
    mode: body.mode ?? inferred?.mode ?? 'web',
    capabilities: missingCaps ? (inferred?.capabilities ?? []) : (body.capabilities ?? []),
  };
}

export async function createTaskFromValidatedBody(body: TaskBodyInput): Promise<Task> {
  const infer = body.infer ?? true;
  if (!infer && !body.mode) throw new Error('mode is required when infer=false');

  const { mode, capabilities } = infer
    ? await resolveInferredSetup(body)
    : { mode: body.mode ?? 'web', capabilities: body.capabilities ?? [] };

  return taskManager.create({
    prompt: body.prompt,
    capabilities,
    attachments: body.attachments,
    mode,
    maxSteps: body.maxSteps,
    timeoutMs: body.timeoutMs,
    source: body.source,
    parentTaskId: body.parentTaskId,
    agentName: body.agentName,
    agentRole: body.agentRole,
    orchestrate: body.orchestrate,
    model: body.model,
    skipMemory: body.skipMemory,
  });
}

export function approveRuntimeTask(id: string): Promise<Task> {
  return taskManager.approve(id);
}

export function cancelRuntimeTask(id: string): Task {
  return taskManager.cancel(id);
}

export function deleteRuntimeTask(id: string): void {
  taskManager.delete(id);
}

export function sendUserMessageToTask(taskId: string, message: string): void {
  taskManager.sendMessage(taskId, 'user', message);
}

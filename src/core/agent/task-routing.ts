import type { Task, TaskCapabilityId, TaskMode, TaskRunnerId } from '../../types';

export function deriveRunner(mode: TaskMode, capabilities: TaskCapabilityId[], orchestrate?: boolean): TaskRunnerId {
  if (orchestrate) return 'orchestrator';
  if (mode === 'code') return 'code';
  if (capabilities.includes('polymarket.trading')) return 'cdp';
  if (capabilities.includes('onchain.trading')) return 'cdp';
  if (capabilities.includes('cex.trading')) return 'cdp';
  if (capabilities.includes('token.deploy')) return 'cdp';
  return 'browser';
}

export function backfillRunner(task: Task): Task {
  if ((task as any).runner) return task;
  const mode = (task.mode ?? 'browser') as TaskMode;
  const caps = (task.capabilities ?? []) as TaskCapabilityId[];
  (task as any).runner = deriveRunner(mode, caps);
  return task;
}

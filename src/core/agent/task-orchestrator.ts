/**
 * TaskOrchestrator — approve, runner lifecycle, spawnAndWait, spawnTask,
 * waitForTasks, cancel. Responsabilidad única: orquestar ejecución.
 */

import { resolveActiveProvider } from '../../core/provider-resolver';
import { listSkills } from '../../db/queries/skills';
import type { ProviderId, Task, TaskCapabilityId, TaskMode } from '../../types';
import { formatFactsForPrompt, formatMemoriesForPrompt } from './task-memory';
import { deriveRunner } from './task-routing';
import { TaskRunner } from './task-runner';
import type { TaskStore } from './task-store';

/** Interfaz que el orchestrator usa para referirse a sí mismo (spawn, wait, cancel). */
export type OrchestratorSelf = {
  spawnAndWait(
    prompt: string,
    parentCapabilities: TaskCapabilityId[],
    parentTaskId?: string,
    agentIdentity?: { agentName?: string; agentRole?: string }
  ): Promise<{ taskId: string; status: Task['status']; output: string; summary?: string; error?: string }>;
  spawnTask(
    prompt: string,
    parentTaskId: string,
    opts?: {
      mode?: TaskMode;
      capabilities?: TaskCapabilityId[];
      agentName?: string;
      agentRole?: string;
      maxSteps?: number;
      model?: string;
    }
  ): Promise<{ taskId: string }>;
  waitForTasks(
    taskIds: string[],
    timeoutMs: number
  ): Promise<Array<{ taskId: string; status: Task['status']; summary?: string; error?: string }>>;
  cancel(taskId: string, reason?: string): Task;
  on(event: 'taskUpdate', listener: (task: Task) => void): unknown;
  removeListener(event: 'taskUpdate', listener: (task: Task) => void): unknown;
};

const DEFAULT_MODEL: Record<ProviderId, string> = {
  chatgpt: 'gpt-4.1-mini',
  claude: 'claude-haiku-4-5-20251001',
  openrouter: 'openai/gpt-4.1-mini',
  ollama: 'qwen2.5:7b',
};

const MAX_CONCURRENT: Record<string, number> = {
  web: 5,
  sandbox: 10,
  cdp: 5,
  orchestrator: 3,
};

export class TaskOrchestrator {
  private runners = new Map<string, TaskRunner>();

  constructor(
    private store: TaskStore,
    private self: OrchestratorSelf
  ) {}

  // ── approve ───────────────────────────────────────────────────

  async approve(taskId: string): Promise<Task> {
    const task = this.store.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status !== 'pending_approval') {
      throw new Error(`Cannot approve task in status: ${task.status}`);
    }

    const runnerKey = task.runner ?? deriveRunner(task.mode, task.capabilities);
    const limit = MAX_CONCURRENT[runnerKey] ?? MAX_CONCURRENT[task.mode] ?? 5;
    const current = [...this.runners.values()].filter((r) => r.getTask().mode === task.mode).length;
    if (current >= limit) {
      throw new Error(`Max ${limit} concurrent ${runnerKey} tasks. Wait for one to finish.`);
    }

    // Mark running
    this.store.updateStatus(taskId, 'running');

    // Resolve context
    const memories = await this.searchMemoriesSafe(task.prompt);
    const facts = await this.searchFactsSafe(task.prompt);
    const skills = await listSkills();

    const activeProvider = await resolveActiveProvider();
    const model = task.model ?? DEFAULT_MODEL[activeProvider];

    const updatedTask = this.store.get(taskId);
    if (!updatedTask) throw new Error(`Task disappeared after approval: ${taskId}`);
    const runner = new TaskRunner(
      updatedTask,
      {
        provider: activeProvider,
        model,
        memoryContext:
          formatMemoriesForPrompt(memories) + formatFactsForPrompt(facts) + skills.map((s) => s.prompt).join('\n'),
        taskManager: this.store as any,
        taskId: updatedTask.id,
        paperMode: false,
      },
      {
        onUpdate: (updated) => this.store.update(updated),
      }
    );

    this.runners.set(taskId, runner);
    const startTime = Date.now();

    runner
      .run()
      .then((final) => this.onRunnerComplete(taskId, final, startTime))
      .catch((e) => this.onRunnerError(taskId, updatedTask, startTime, e))
      .catch((e) => {
        // Safety net: if onRunnerError itself throws, log and mark task failed.
        console.error('[task:runner] unhandled error in error handler:', e);
        this.store.updateStatus(taskId, 'failed', `Internal error: ${e instanceof Error ? e.message : String(e)}`);
      });

    return updatedTask;
  }

  // ── spawnAndWait ──────────────────────────────────────────────

  async spawnAndWait(
    prompt: string,
    parentCapabilities: TaskCapabilityId[],
    parentTaskId?: string,
    agentIdentity?: { agentName?: string; agentRole?: string }
  ): Promise<{ taskId: string; status: Task['status']; output: string; summary?: string; error?: string }> {
    const task = this.store.create({
      prompt,
      capabilities: parentCapabilities,
      parentTaskId,
      agentName: agentIdentity?.agentName,
      agentRole: agentIdentity?.agentRole,
    });
    await this.approve(task.id);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.self.cancel(task.id);
          reject(new Error('Sub-task timed out'));
        },
        10 * 60 * 1000
      );

      const onUpdate = (updated: Task) => {
        if (updated.id !== task.id) return;
        const terminal =
          updated.status === 'completed' || updated.status === 'failed' || updated.status === 'cancelled';
        if (!terminal) return;
        clearTimeout(timeout);
        this.self.removeListener('taskUpdate', onUpdate);
        resolve(this.extractTaskResult(updated));
      };
      this.self.on('taskUpdate', onUpdate);
    });
  }

  // ── spawnTask ─────────────────────────────────────────────────

  async spawnTask(
    prompt: string,
    parentTaskId: string,
    opts?: {
      mode?: TaskMode;
      capabilities?: TaskCapabilityId[];
      agentName?: string;
      agentRole?: string;
      maxSteps?: number;
      model?: string;
    }
  ): Promise<{ taskId: string }> {
    const parent = this.store.get(parentTaskId);
    const task = this.store.create({
      prompt,
      mode: opts?.mode,
      capabilities: opts?.capabilities ?? parent?.capabilities ?? [],
      parentTaskId,
      agentName: opts?.agentName,
      agentRole: opts?.agentRole,
      maxSteps: opts?.maxSteps,
      model: opts?.model,
      skipMemory: true,
    });
    await this.approve(task.id);
    return { taskId: task.id };
  }

  // ── waitForTasks ──────────────────────────────────────────────

  async waitForTasks(
    taskIds: string[],
    timeoutMs: number
  ): Promise<
    Array<{
      taskId: string;
      status: Task['status'];
      summary?: string;
      error?: string;
    }>
  > {
    const results: Array<{ taskId: string; status: Task['status']; summary?: string; error?: string }> = [];
    const TERMINAL = new Set<Task['status']>(['completed', 'failed', 'cancelled']);

    await Promise.all(
      taskIds.map(
        (id) =>
          new Promise<void>((resolve) => {
            const task = this.store.get(id);
            if (!task) {
              results.push({ taskId: id, status: 'failed', error: `Task ${id} not found` });
              resolve();
              return;
            }
            if (TERMINAL.has(task.status)) {
              results.push({ taskId: id, status: task.status, summary: task.summary, error: task.error });
              resolve();
              return;
            }
            const timer = setTimeout(() => {
              this.self.removeListener('taskUpdate', onUpdate);
              results.push({ taskId: id, status: 'failed', error: `Task ${id} timed out` });
              resolve();
            }, timeoutMs);
            const onUpdate = (updated: Task) => {
              if (updated.id !== id) return;
              if (TERMINAL.has(updated.status)) {
                clearTimeout(timer);
                this.self.removeListener('taskUpdate', onUpdate);
                results.push({ taskId: id, status: updated.status, summary: updated.summary, error: updated.error });
                resolve();
              }
            };
            this.self.on('taskUpdate', onUpdate as any);
          })
      )
    );

    return results;
  }

  // ── cancel ────────────────────────────────────────────────────

  cancel(taskId: string, reason = 'Cancelled by user'): Task {
    const task = this.store.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return task;

    const runner = this.runners.get(taskId);
    if (runner) {
      runner.abort(reason);
      this.runners.delete(taskId);
    }
    const cancelled = this.store.updateStatus(taskId, 'cancelled', reason);
    if (!cancelled) throw new Error(`Task not found during cancel: ${taskId}`);
    return cancelled;
  }

  // ── delete (abort runner) ─────────────────────────────────────

  delete(taskId: string): void {
    const runner = this.runners.get(taskId);
    if (runner) {
      runner.abort('Deleted');
      this.runners.delete(taskId);
    }
    this.store.delete(taskId);
  }

  // ── shutdown ──────────────────────────────────────────────────

  async destroyAll(): Promise<void> {
    for (const [id, runner] of this.runners) {
      runner.abort('App shutting down');
      this.runners.delete(id);
    }
    await this.store.destroyAll();
  }

  // ── runner callbacks ──────────────────────────────────────────

  private onRunnerComplete(taskId: string, final: Task, startTime: number): void {
    this.runners.delete(taskId);
    this.store.extractAndSaveMemory(final, Date.now() - startTime);
    this.store.updateInDb(final);
  }

  private onRunnerError(taskId: string, task: Task, startTime: number, e: unknown): void {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('[task:runnerError] taskId=', taskId, 'error=', errMsg);
    this.runners.delete(taskId);
    this.store.updateStatus(task.id, 'failed', errMsg);
    this.store.extractAndSaveMemory(task, Date.now() - startTime);
  }

  // ── helpers ───────────────────────────────────────────────────

  private extractTaskResult(task: Task): {
    taskId: string;
    status: Task['status'];
    output: string;
    summary?: string;
    error?: string;
  } {
    const doneStep = [...task.steps].reverse().find((s) => (s.action as any)?.type === 'done');
    const doneOutput = (doneStep?.action as any)?.summary as string | undefined;
    const output =
      task.status === 'completed'
        ? (doneOutput ?? task.summary ?? '')
        : (task.error ?? doneOutput ?? task.summary ?? '');
    return {
      taskId: task.id,
      status: task.status,
      output: output || `Sub-task ${task.status}`,
      summary: task.summary,
      error: task.error,
    };
  }

  private async searchMemoriesSafe(prompt: string) {
    try {
      const { searchMemories } = require('./task-memory');
      return await searchMemories(prompt);
    } catch {
      return [];
    }
  }

  private async searchFactsSafe(prompt: string) {
    try {
      const { searchFacts } = require('./task-memory');
      return await searchFacts(prompt);
    } catch {
      return [];
    }
  }
}

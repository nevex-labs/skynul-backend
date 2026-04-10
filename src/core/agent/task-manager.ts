/**
 * TaskManager — CRUD de tareas + orquestación de TaskRunners.
 * Persistencia en DB via queries.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { resolveActiveProvider } from '../../core/provider-resolver';
import { listSkills } from '../../db/queries/skills';
import {
  createTask,
  deleteTask as dbDeleteTask,
  getTasksByUser,
  updateTask,
  updateTaskStatus,
} from '../../db/queries/tasks';
import { getSystemUserId } from '../../db/queries/users';
import type { ProviderId, Task, TaskCapabilityId, TaskCreateRequest, TaskMode } from '../../types';
import { broadcast } from '../../ws/events';
import { isPerTaskBrowserSessionMode, parseBrowserSessionMode } from '../browser/session-mode';
import { formatFactsForPrompt, formatMemoriesForPrompt, saveMemory, searchFacts, searchMemories } from './task-memory';
import { deriveRunner } from './task-routing';
import { TaskRunner } from './task-runner';

function n<T>(v: T | undefined): T | null {
  return v ?? null;
}

const DEFAULT_MODEL: Record<ProviderId, string> = {
  chatgpt: 'gpt-4.1-mini',
  claude: 'claude-haiku-4-5-20251001',
  openrouter: 'openai/gpt-4.1-mini',
  ollama: 'llama3.2',
};

const DEFAULT_MAX_STEPS = 200;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const TRADING_MAX_STEPS = 500;
const TRADING_TIMEOUT_MS = 4 * 60 * 60 * 1000;

function isTradingTask(capabilities: string[]): boolean {
  return capabilities.some((c) => c.endsWith('.trading'));
}

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function inferAgentRole(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/(\bcopy\b|caption|cta|hashtags|post copy|copywriter)/.test(p)) return 'Copy';
  if (/(\bimage\b|imagen|meme|design|visual|thumbnail|banner)/.test(p)) return 'Design';
  if (/(\bbrowser\b|navigate|open\s+x\b|open\s+twitter\b|x\.com|instagram|draft|borrador)/.test(p)) return 'Browser';
  if (/(\bresearch\b|investigate|find\b|lookup|look up|buscar|averigua|averigu[aá])/i.test(prompt)) return 'Research';
  if (/(\bqa\b|review|verify|checklist|proofread)/.test(p)) return 'QA';
  return 'Agent';
}

const AGENT_NAME_POOLS: Record<string, string[]> = {
  manager: ['Atlas', 'Kernel', 'Director', 'Control'],
  browser: ['Orbit', 'Navigator', 'Relay', 'Pilot'],
  copy: ['Quill', 'Copydesk', 'Scribe', 'Draft'],
  design: ['Prism', 'Vector', 'Canvas', 'Studio'],
  research: ['Glyph', 'Index', 'Scout', 'Signal'],
  qa: ['Aegis', 'Verifier', 'Audit', 'Gate'],
  code: ['Forge', 'Compiler', 'Builder', 'Refactor'],
  agent: ['Node', 'Module', 'Echo', 'Nova'],
};

const ROLE_TO_POOL: Record<string, string> = {
  manager: 'manager',
  orchestrator: 'manager',
  browser: 'browser',
  navigator: 'browser',
  copy: 'copy',
  copywriter: 'copy',
  design: 'design',
  image: 'design',
  imagen: 'design',
  research: 'research',
  investigator: 'research',
  qa: 'qa',
  review: 'qa',
  code: 'code',
  dev: 'code',
};

function pickAgentName(role: string, seed: string): string {
  const key = ROLE_TO_POOL[role.trim().toLowerCase()] ?? 'agent';
  const pool = AGENT_NAME_POOLS[key] ?? AGENT_NAME_POOLS.agent;
  return pool[hash32(seed) % pool.length] ?? 'Nova';
}

const MAX_CONCURRENT: Record<string, number> = {
  web: isPerTaskBrowserSessionMode(parseBrowserSessionMode()) ? 1 : 5,
  sandbox: 10,
  cdp: isPerTaskBrowserSessionMode(parseBrowserSessionMode()) ? 1 : 5,
  orchestrator: 3,
};

type TaskManagerEvents = {
  taskUpdate: [task: Task];
};

export class TaskManager extends EventEmitter<TaskManagerEvents> {
  private tasks = new Map<string, Task>();
  private runners = new Map<string, TaskRunner>();
  private inboxes = new Map<string, Array<{ from: string; message: string }>>();
  private systemUserId: string | null = null;

  constructor() {
    super();
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      this.systemUserId = await getSystemUserId();
      await this.loadFromDb();
    } catch {
      /* DB not available at startup */
    }
  }

  private buildOptionalTaskFields(task: Task) {
    return {
      parentTaskId: n(task.parentTaskId),
      attachments: n(task.attachments),
      plan: n(task.plan),
      agentName: n(task.agentName),
      agentRole: n(task.agentRole),
      skipMemory: task.skipMemory ?? false,
      usageInputTokens: task.usage?.inputTokens ?? null,
      usageOutputTokens: task.usage?.outputTokens ?? null,
      summary: n(task.summary),
      error: n(task.error),
      source: n(task.source),
      model: n(task.model),
    };
  }

  private buildTaskRecord(task: Task, userId: string) {
    return {
      id: task.id,
      userId,
      status: task.status,
      mode: task.mode,
      orchestrate: task.orchestrate,
      capabilities: task.capabilities,
      prompt: task.prompt,
      maxSteps: task.maxSteps,
      timeoutMs: task.timeoutMs,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      ...this.buildOptionalTaskFields(task),
    };
  }

  private insertInDb(task: Task): void {
    if (!this.systemUserId) return;
    void createTask(this.buildTaskRecord(task, this.systemUserId)).catch((e) =>
      console.error('[task] insert error:', e)
    );
  }

  private updateInDb(task: Task): void {
    void updateTask(task.id, {
      status: task.status,
      summary: task.summary ?? undefined,
      error: task.error ?? undefined,
      usageInputTokens: task.usage?.inputTokens,
      usageOutputTokens: task.usage?.outputTokens,
    }).catch((e) => console.error('[task] update error:', e));
  }

  private resolveTaskLimits(
    capabilities: TaskCapabilityId[],
    maxSteps?: number,
    timeoutMs?: number
  ): { maxSteps: number; timeoutMs: number } {
    const isTrading = isTradingTask(capabilities);
    return {
      maxSteps: maxSteps ?? (isTrading ? TRADING_MAX_STEPS : DEFAULT_MAX_STEPS),
      timeoutMs: timeoutMs ?? (isTrading ? TRADING_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
    };
  }

  create(req: TaskCreateRequest): Task {
    const id = randomUUID();
    const agentRole = req.agentRole ?? (req.parentTaskId ? inferAgentRole(req.prompt) : undefined);
    const agentName = req.agentName ?? (req.parentTaskId ? pickAgentName(agentRole ?? 'Agent', id) : undefined);
    const mode = req.mode ?? 'sandbox';
    const capabilities = req.capabilities ?? [];
    const now = Date.now();
    const limits = this.resolveTaskLimits(capabilities, req.maxSteps, req.timeoutMs);

    const task: Task = {
      id,
      parentTaskId: req.parentTaskId,
      agentName,
      agentRole,
      prompt: req.prompt,
      attachments: req.attachments,
      status: 'pending_approval',
      mode,
      capabilities,
      steps: [],
      createdAt: now,
      updatedAt: now,
      maxSteps: limits.maxSteps,
      timeoutMs: limits.timeoutMs,
      source: req.source ?? 'desktop',
      model: req.model,
      skipMemory: req.skipMemory,
      orchestrate: req.orchestrate ?? 'single',
      runner: deriveRunner(mode, capabilities, req.orchestrate),
    };

    this.tasks.set(id, task);
    this.insertInDb(task);
    return task;
  }

  async approve(taskId: string): Promise<Task> {
    const task = this.getOrThrow(taskId);
    if (task.status !== 'pending_approval') {
      throw new Error(`Cannot approve task in status: ${task.status}`);
    }

    const runnerKey = task.runner ?? deriveRunner(task.mode, task.capabilities);
    const limit = MAX_CONCURRENT[runnerKey] ?? MAX_CONCURRENT[task.mode] ?? 5;
    const current = [...this.runners.values()].filter((r) => r.getTask().mode === task.mode).length;
    if (current >= limit) {
      throw new Error(`Max ${limit} concurrent ${runnerKey} tasks. Wait for one to finish.`);
    }

    task.status = 'running';
    task.updatedAt = Date.now();
    this.pushUpdate(task);
    this.updateInDb(task);

    const memories = await searchMemories(task.prompt);
    const facts = await searchFacts(task.prompt);
    const skills = await listSkills();

    const activeProvider = await resolveActiveProvider();
    const runner = new TaskRunner(
      task,
      {
        provider: activeProvider,
        model: task.model ?? DEFAULT_MODEL[activeProvider],
        memoryContext:
          formatMemoriesForPrompt(memories) + formatFactsForPrompt(facts) + skills.map((s) => s.prompt).join('\n'),
        taskManager: this,
        taskId: task.id,
        paperMode: false,
      },
      {
        onUpdate: (updated) => {
          this.tasks.set(updated.id, updated);
          this.pushUpdate(updated);
          this.updateInDb(updated);
        },
      }
    );

    this.runners.set(taskId, runner);
    const startTime = Date.now();

    runner
      .run()
      .then((final) => this.onRunnerComplete(taskId, final, startTime))
      .catch((e) => this.onRunnerError(taskId, task, startTime, e));

    return task;
  }

  async spawnAndWait(
    prompt: string,
    parentCapabilities: TaskCapabilityId[],
    parentTaskId?: string,
    agentIdentity?: { agentName?: string; agentRole?: string }
  ): Promise<{ taskId: string; status: Task['status']; output: string; summary?: string; error?: string }> {
    const task = this.create({
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
          this.cancel(task.id);
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
        this.removeListener('taskUpdate', onUpdate);
        resolve(this.extractTaskResult(updated));
      };
      this.on('taskUpdate', onUpdate);
    });
  }

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
    const parent = this.tasks.get(parentTaskId);
    const task = this.create({
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
            const task = this.tasks.get(id);
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
              this.removeListener('taskUpdate', onUpdate);
              results.push({ taskId: id, status: 'failed', error: `Task ${id} timed out` });
              resolve();
            }, timeoutMs);
            const onUpdate = (updated: Task) => {
              if (updated.id !== id) return;
              if (TERMINAL.has(updated.status)) {
                clearTimeout(timer);
                this.removeListener('taskUpdate', onUpdate);
                results.push({ taskId: id, status: updated.status, summary: updated.summary, error: updated.error });
                resolve();
              }
            };
            this.on('taskUpdate', onUpdate);
          })
      )
    );

    return results;
  }

  sendMessage(targetTaskId: string, fromTaskId: string, message: string): void {
    const target = this.tasks.get(targetTaskId);
    if (!target) throw new Error(`Task not found: ${targetTaskId}`);
    if (target.status !== 'running') throw new Error(`Task ${targetTaskId} is not running`);
    const inbox = this.inboxes.get(targetTaskId) ?? [];
    inbox.push({ from: fromTaskId, message });
    this.inboxes.set(targetTaskId, inbox);
    target.steps.push({
      index: target.steps.length,
      timestamp: Date.now(),
      screenshotBase64: '',
      action: { type: 'user_message', text: message },
    });
    target.updatedAt = Date.now();
    this.pushUpdate(target);
  }

  drainMessages(taskId: string): Array<{ from: string; message: string }> {
    const inbox = this.inboxes.get(taskId);
    if (!inbox?.length) return [];
    this.inboxes.set(taskId, []);
    return inbox;
  }

  cancel(taskId: string, reason = 'Cancelled by user'): Task {
    const task = this.getOrThrow(taskId);
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return task;
    const runner = this.runners.get(taskId);
    if (runner) {
      runner.abort(reason);
      this.runners.delete(taskId);
    }
    task.status = 'cancelled';
    task.error = reason;
    task.updatedAt = Date.now();
    this.tasks.set(taskId, task);
    this.pushUpdate(task);
    this.updateInDb(task);
    return task;
  }

  delete(taskId: string): void {
    const runner = this.runners.get(taskId);
    if (runner) {
      runner.abort('Deleted');
      this.runners.delete(taskId);
    }
    this.tasks.delete(taskId);
    void dbDeleteTask(taskId);
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }
  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async destroyAll(): Promise<void> {
    for (const [id, runner] of this.runners) {
      runner.abort('App shutting down');
      this.runners.delete(id);
      const task = this.tasks.get(id);
      if (task?.status === 'running') {
        task.status = 'cancelled';
        task.error = 'App shutting down';
        task.updatedAt = Date.now();
        this.tasks.set(id, task);
        this.pushUpdate(task);
      }
    }
  }

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

  private onRunnerComplete(taskId: string, final: Task, startTime: number): void {
    this.tasks.set(final.id, final);
    this.runners.delete(taskId);
    this.extractAndSaveMemory(final, Date.now() - startTime);
    this.updateInDb(final);
  }

  private onRunnerError(taskId: string, task: Task, startTime: number, e: unknown): void {
    task.status = 'failed';
    task.error = e instanceof Error ? e.message : String(e);
    task.updatedAt = Date.now();
    this.tasks.set(taskId, task);
    this.pushUpdate(task);
    this.runners.delete(taskId);
    this.extractAndSaveMemory(task, Date.now() - startTime);
    this.updateInDb(task);
  }

  private getOrThrow(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  private pushUpdate(task: Task): void {
    broadcast({ type: 'task:update', payload: { task } });
    this.emit('taskUpdate', task);
  }

  private mapDbRowToRuntimeTask(t: Awaited<ReturnType<typeof getTasksByUser>>[number]): Task {
    const mode = t.mode as TaskMode;
    const capabilities = t.capabilities as TaskCapabilityId[];
    return {
      id: t.id,
      parentTaskId: t.parentTaskId ?? undefined,
      agentName: t.agentName ?? undefined,
      agentRole: t.agentRole ?? undefined,
      prompt: t.prompt,
      attachments: t.attachments ?? undefined,
      status: t.status as Task['status'],
      mode,
      capabilities,
      steps: [],
      createdAt: Number(t.createdAt),
      updatedAt: Number(t.updatedAt),
      maxSteps: t.maxSteps,
      timeoutMs: t.timeoutMs,
      source: (t.source ?? undefined) as Task['source'],
      model: (t.model ?? undefined) as Task['model'],
      skipMemory: (t.skipMemory ?? false) as Task['skipMemory'],
      orchestrate: (t.orchestrate as Task['orchestrate']) ?? 'single',
      runner: deriveRunner(mode, capabilities, undefined),
    };
  }

  private async loadFromDb(): Promise<void> {
    try {
      if (!this.systemUserId) return;
      const rows = await getTasksByUser(this.systemUserId);
      for (const t of rows) {
        const runtimeTask = this.mapDbRowToRuntimeTask(t);
        const isTerminal = t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled';
        if (isTerminal) {
          this.tasks.set(t.id, runtimeTask);
        } else {
          runtimeTask.status = 'failed';
          runtimeTask.error = 'Interrupted by server restart';
          runtimeTask.updatedAt = Date.now();
          await updateTaskStatus(t.id, 'failed');
          this.tasks.set(t.id, runtimeTask);
        }
      }
    } catch {
      /* DB not available */
    }
  }

  private collectStepInsights(steps: Task['steps']): { selectors: string[]; urls: string[]; failed: string[] } {
    const selectors: string[] = [];
    const urls: string[] = [];
    const failed: string[] = [];
    for (const step of steps) {
      const raw = step.action as Record<string, unknown>;
      const type = raw.type as string;
      if ((type === 'click' || type === 'type') && raw.selector && !step.error) selectors.push(String(raw.selector));
      if (type === 'navigate' && raw.url) urls.push(String(raw.url));
      if (step.error) failed.push(`${type}: ${step.error.slice(0, 120)}`);
    }
    return { selectors, urls, failed };
  }

  private extractAndSaveMemory(task: Task, durationMs: number): void {
    if (task.status !== 'completed' && task.status !== 'failed') return;
    const summary = task.summary ?? task.error ?? 'No summary';
    const { selectors, urls, failed } = this.collectStepInsights(task.steps);
    const parts = [`Outcome: ${summary}. Steps: ${task.steps.length}. Duration: ${Math.round(durationMs / 1000)}s.`];
    if (urls.length) parts.push(`URLs: ${urls.slice(0, 5).join(', ')}`);
    if (selectors.length) parts.push(`Selectors: ${selectors.slice(0, 10).join(' | ')}`);
    if (failed.length) parts.push(`Failed: ${failed.slice(0, 5).join('; ')}`);
    saveMemory({
      taskId: task.id,
      prompt: task.prompt,
      outcome: task.status === 'completed' ? 'completed' : 'failed',
      learnings: parts.join('\n'),
    });
  }
}

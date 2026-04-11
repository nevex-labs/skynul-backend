/**
 * TaskStore — persistencia, memoria RAM, broadcast WS y mapeo DB.
 * Responsabilidad única: store de tareas.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  createTask,
  deleteTask as dbDeleteTask,
  getTasksByUser,
  updateTask,
  updateTaskStatus,
} from '../../db/queries/tasks';
import { getSystemUserId } from '../../db/queries/users';
import type { Task, TaskCapabilityId, TaskCreateRequest, TaskMode } from '../../types';
import { broadcast } from '../../ws/events';
import { deriveRunner } from './task-routing';

// ── helpers ──────────────────────────────────────────────────────

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

function n<T>(v: T | undefined): T | null {
  return v ?? null;
}

// ── types ────────────────────────────────────────────────────────

type TaskStoreEvents = {
  taskUpdate: [task: Task];
};

// ── class ────────────────────────────────────────────────────────

export class TaskStore extends EventEmitter<TaskStoreEvents> {
  private tasks = new Map<string, Task>();
  private inboxes = new Map<string, Array<{ from: string; message: string }>>();
  private systemUserId: string | null = null;

  // ── Throttled DB writes ─────────────────────────────────────
  // Accumulates task updates and flushes to DB at most once per
  // THROTTLE_MS. Prevents DB write storms during fast LLM loops.
  private dirtyTasks = new Map<string, Task>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FLUSH_INTERVAL_MS = 2_000;

  // ── Eviction of terminal tasks ──────────────────────────────
  // Removes completed/failed/cancelled tasks from RAM after a
  // delay to prevent unbounded memory growth.
  private static readonly EVICT_AFTER_MS = 10 * 60 * 1000; // 10 min
  private evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    super();
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      this.systemUserId = await getSystemUserId();
      await this.loadFromDb();
    } catch {
      /* DB not available */
    }
  }

  // ── create / read / update / delete ───────────────────────────

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

  updateInDb(task: Task): void {
    void updateTask(task.id, {
      status: task.status,
      summary: task.summary ?? undefined,
      error: task.error ?? undefined,
      usageInputTokens: task.usage?.inputTokens,
      usageOutputTokens: task.usage?.outputTokens,
    }).catch((e) => console.error('[task] update error:', e));
  }

  /** Queue a task for throttled DB flush instead of immediate write. */
  private queueFlush(task: Task): void {
    this.dirtyTasks.set(task.id, task);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flushDirty(), TaskStore.FLUSH_INTERVAL_MS);
  }

  private flushDirty(): void {
    this.flushTimer = null;
    const batch = [...this.dirtyTasks.values()];
    this.dirtyTasks.clear();
    for (const task of batch) {
      void updateTask(task.id, {
        status: task.status,
        summary: task.summary ?? undefined,
        error: task.error ?? undefined,
        usageInputTokens: task.usage?.inputTokens,
        usageOutputTokens: task.usage?.outputTokens,
      }).catch((e) => console.error('[task] flush error:', e));
    }
  }

  /** Schedule eviction of a terminal task from RAM after a delay. */
  private scheduleEviction(taskId: string): void {
    if (this.evictionTimers.has(taskId)) return;
    const timer = setTimeout(() => {
      this.evictionTimers.delete(taskId);
      // Only evict if still terminal and no runner active
      const task = this.tasks.get(taskId);
      if (task && !this.evictionTimers.has(taskId)) {
        const terminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
        if (terminal) this.tasks.delete(taskId);
      }
    }, TaskStore.EVICT_AFTER_MS);
    this.evictionTimers.set(taskId, timer);
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

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  updateStatus(taskId: string, status: Task['status'], error?: string): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    task.status = status;
    if (error !== undefined) task.error = error;
    task.updatedAt = Date.now();
    this.pushUpdate(task);
    this.queueFlush(task);

    // Schedule eviction for terminal tasks
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      this.scheduleEviction(taskId);
    }
    return task;
  }

  update(task: Task): void {
    this.tasks.set(task.id, task);
    this.pushUpdate(task);
    this.queueFlush(task);
  }

  delete(taskId: string): void {
    this.tasks.delete(taskId);
    void dbDeleteTask(taskId);
  }

  // ── messaging ─────────────────────────────────────────────────

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

  // ── lifecycle ─────────────────────────────────────────────────

  async destroyAll(): Promise<void> {
    // Cancel flush timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Flush remaining dirty tasks before shutdown
    this.flushDirty();
    // Cancel eviction timers
    for (const timer of this.evictionTimers.values()) clearTimeout(timer);
    this.evictionTimers.clear();

    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        task.status = 'cancelled';
        task.error = 'App shutting down';
        task.updatedAt = Date.now();
        this.pushUpdate(task);
      }
    }
  }

  // ── memory extraction ─────────────────────────────────────────

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

  extractAndSaveMemory(task: Task, durationMs: number): void {
    if (task.status !== 'completed' && task.status !== 'failed') return;
    const summary = task.summary ?? task.error ?? 'No summary';
    const { selectors, urls, failed } = this.collectStepInsights(task.steps);
    const parts = [`Outcome: ${summary}. Steps: ${task.steps.length}. Duration: ${Math.round(durationMs / 1000)}s.`];
    if (urls.length) parts.push(`URLs: ${urls.slice(0, 5).join(', ')}`);
    if (selectors.length) parts.push(`Selectors: ${selectors.slice(0, 10).join(' | ')}`);
    if (failed.length) parts.push(`Failed: ${failed.slice(0, 5).join('; ')}`);
    const { saveMemory } = require('./task-memory');
    saveMemory({
      taskId: task.id,
      prompt: task.prompt,
      outcome: task.status === 'completed' ? 'completed' : 'failed',
      learnings: parts.join('\n'),
    });
  }

  // ── DB load ───────────────────────────────────────────────────

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

  // ── broadcast ─────────────────────────────────────────────────

  private pushUpdate(task: Task): void {
    broadcast({ type: 'task:update', payload: { task } });
    this.emit('taskUpdate', task);
  }
}

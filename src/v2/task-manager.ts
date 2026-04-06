/**
 * Layer 5: Task Manager
 *
 * High-level task lifecycle management: CRUD operations, task creation,
 * approval flow, and coordination with the Task Runner.
 *
 * Does NOT know about:
 * - Provider resolution internals (delegates to Layer 1)
 * - LLM calls (delegates to Layer 2 via Task Runner)
 * - Secrets or API keys
 * - Conversation history or action execution
 *
 * Dependencies:
 * - Layer 1: resolveProvider (for approval flow)
 * - Layer 2: dispatchChat (injected via callLLM factory)
 * - Layer 4: runTask (for execution)
 */

import { randomUUID } from 'crypto';
import type { LoopRegistry } from './loop-registry';
import type { ProviderId } from './provider-dispatch';
import { type ChatMessage, dispatchChat } from './provider-dispatch';
import { resolveProvider } from './provider-resolver';
import { readSecret } from './secret-reader';
import type { SecretReader } from './secret-reader';
import type { Task, TaskMode } from './task-runner';
import { runTask } from './task-runner';

// ── Types ──────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'approved' | 'running' | 'completed' | 'failed' | 'cancelled';

export type TaskCreateRequest = {
  /** User's prompt */
  prompt: string;

  /** Optional: explicitly set mode */
  mode?: TaskMode;

  /** Optional: explicitly set capabilities */
  capabilities?: string[];

  /** Optional: user ID for multi-tenant isolation */
  userId?: number;

  /** Optional: attachment file paths */
  attachments?: string[];

  /** Optional: model override */
  model?: string;

  /** Optional: whether to run inference (default: true) */
  infer?: boolean;

  /** Optional: agent system prompt */
  agentSystemPrompt?: string;

  /** Optional: allowed tools */
  agentAllowedTools?: string[];

  /** Optional: max steps */
  maxSteps?: number;
};

export type TaskManagerOpts = {
  /** Function to read secrets from storage */
  readSecret: SecretReader;

  /** Loop registry for mode-specific setup */
  loopRegistry: LoopRegistry;

  /** Called when a task is created */
  onTaskCreated?: (task: Task) => void;

  /** Called when a task status changes */
  onTaskUpdate?: (task: Task) => void;

  /** Default max steps if not specified in request */
  defaultMaxSteps?: number;

  /** Default context window in tokens */
  defaultContextWindow?: number;
};

// ── Task Store ─────────────────────────────────────────────────────────

/**
 * In-memory task store.
 * In production, this would be replaced with a database-backed implementation.
 */
export class TaskStore {
  private tasks = new Map<string, Task>();

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  set(task: Task): void {
    this.tasks.set(task.id, task);
  }

  list(filter?: { userId?: number }): Task[] {
    let all = Array.from(this.tasks.values());
    if (filter?.userId !== undefined) {
      all = all.filter((t) => t.userId === filter.userId);
    }
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  delete(id: string): boolean {
    return this.tasks.delete(id);
  }

  clear(): void {
    this.tasks.clear();
  }
}

// ── Task Manager ───────────────────────────────────────────────────────

/**
 * Task Manager — CRUD + lifecycle for tasks.
 */
export class TaskManager {
  private store: TaskStore;
  private opts: TaskManagerOpts;
  private shuttingDown = false;
  private running = new Map<string, Promise<Task>>();

  constructor(store: TaskStore, opts: TaskManagerOpts) {
    this.store = store;
    this.opts = opts;
  }

  // ── CRUD ───────────────────────────────────────────────────────────

  /**
   * Create a new task from a user request.
   *
   * If capabilities are not provided, they default to an empty array.
   * The task starts in 'pending' status and must be approved before running.
   */
  async create(request: TaskCreateRequest): Promise<Task> {
    if (this.shuttingDown) {
      throw new Error('Server is shutting down');
    }
    const now = Date.now();
    const id = generateTaskId();

    const task: Task = {
      id,
      prompt: request.prompt,
      mode: request.mode ?? 'code',
      capabilities: request.capabilities ?? [],
      status: 'pending',
      steps: [],
      userId: request.userId,
      createdAt: now,
      updatedAt: now,
    };

    this.store.set(task);
    this.opts.onTaskCreated?.(task);

    return task;
  }

  /**
   * Get a task by ID.
   */
  get(taskId: string): Task | undefined {
    return this.store.get(taskId);
  }

  /**
   * List tasks, optionally filtered by user.
   */
  list(userId?: number): Task[] {
    return this.store.list(userId ? { userId } : undefined);
  }

  /**
   * Delete a task by ID.
   */
  delete(taskId: string): boolean {
    return this.store.delete(taskId);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Approve a task for execution.
   *
   * Flow:
   * 1. Validate task exists and is pending
   * 2. Resolve the provider (Layer 1)
   * 3. Create action executors
   * 4. Run the task (Layer 4)
   */
  async approve(taskId: string): Promise<Task> {
    if (this.shuttingDown) {
      throw new Error('Server is shutting down');
    }
    const task = this.store.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'pending') {
      throw new Error(`Task cannot be approved: status is '${task.status}'`);
    }

    // Resolve provider (Layer 1)
    const provider = await resolveProvider(this.opts.readSecret, task.userId);

    // Get loop setup from registry
    const setupFn = this.opts.loopRegistry.get(task.mode);
    if (!setupFn) {
      throw new Error(`No loop registered for mode: ${task.mode}`);
    }

    const setup = await setupFn(task);

    // Build callLLM function (Layer 2)
    const callLLM = async (messages: { role: string; content: string }[]) => {
      return dispatchChat(provider, messages as ChatMessage[], this.opts.readSecret, task.userId);
    };

    const runPromise = runTask({
      task,
      provider,
      callLLM,
      actionExecutors: setup.actionExecutors,
      systemPrompt: setup.systemPrompt,
      initialHistory: setup.initialHistory,
      formatObservation: setup.formatObservation,
      cleanup: setup.cleanup,
      maxSteps: this.opts.defaultMaxSteps ?? 50,
      contextWindow: this.opts.defaultContextWindow,
      callbacks: {
        onUpdate: (updatedTask) => {
          this.store.set(updatedTask);
          this.opts.onTaskUpdate?.(updatedTask);
        },
      },
    });

    this.running.set(task.id, runPromise);
    try {
      return await runPromise;
    } finally {
      this.running.delete(task.id);
    }
  }

  /**
   * Abort a running task.
   */
  abort(taskId: string): Task {
    const task = this.store.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'running') {
      throw new Error(`Task cannot be aborted: status is '${task.status}'`);
    }

    task.status = 'cancelled';
    task.updatedAt = Date.now();
    this.store.set(task);
    this.opts.onTaskUpdate?.(task);

    return task;
  }

  /**
   * Resume a task with a new user message.
   * Only works for tasks that are 'completed' (chat continuation).
   */
  async resume(taskId: string, message: string): Promise<Task> {
    if (this.shuttingDown) {
      throw new Error('Server is shutting down');
    }
    const task = this.store.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== 'completed') {
      throw new Error(`Task cannot be resumed: status is '${task.status}'`);
    }

    // Append user message to prompt
    task.prompt = `${task.prompt}\n\nFollow-up: ${message}`;
    task.status = 'pending';
    task.updatedAt = Date.now();
    this.store.set(task);
    this.opts.onTaskUpdate?.(task);

    // Re-approve and run
    return this.approve(taskId);
  }

  markShuttingDown(): number {
    this.shuttingDown = true;
    let count = 0;
    for (const t of this.store.list()) {
      if (t.status === 'running') {
        t.status = 'cancelled';
        t.error = t.error ?? 'Server shutting down';
        t.updatedAt = Date.now();
        this.store.set(t);
        this.opts.onTaskUpdate?.(t);
        count++;
      }
    }
    return count;
  }

  getActiveTaskCount(): number {
    return this.running.size;
  }

  async waitForAllTasks(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.running.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return this.running.size === 0;
  }

  destroyAll(): void {
    for (const t of this.store.list()) {
      if (t.status === 'running') {
        t.status = 'cancelled';
        t.error = 'App shutting down';
        t.updatedAt = Date.now();
        this.store.set(t);
        this.opts.onTaskUpdate?.(t);
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function generateTaskId(): string {
  return randomUUID();
}

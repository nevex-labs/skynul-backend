/**
 * TaskManager — CRUD for tasks + orchestrates TaskRunners.
 */

import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { Effect } from 'effect';
import { DatabaseLive } from '../../services/database';
import { EvalFeedbackService, EvalFeedbackServiceLive } from '../../services/eval-feedback';
import { TaskMemoryService, TaskMemoryServiceLive } from '../../services/task-memory';
import { DatabaseError } from '../../shared/errors';
import type { AgentDefinition, PolicyState, Task, TaskCapabilityId, TaskCreateRequest, TaskMode } from '../../types';
import { broadcast } from '../../ws/events';
import { isPerTaskBrowserSessionMode, parseBrowserSessionMode } from '../browser/session-mode';
import { getActiveSkillPrompts, loadSkills } from '../stores/skill-store';
import type { AgentRegistry } from './agent-registry';
import { recallMemoriesFast } from './memory-recall';
import { deriveRunner } from './task-routing';

// Helper to run EvalFeedbackService effects
async function runEvalFeedbackEffect<T>(effect: Effect.Effect<T, DatabaseError, EvalFeedbackService>): Promise<T> {
  const program = effect.pipe(Effect.provide(EvalFeedbackServiceLive), Effect.provide(DatabaseLive));
  return Effect.runPromise(program as Effect.Effect<T, never, never>);
}

// Helper to run TaskMemoryService effects
async function runTaskMemoryEffect<T>(effect: Effect.Effect<T, DatabaseError, TaskMemoryService>): Promise<T> {
  const program = effect.pipe(Effect.provide(TaskMemoryServiceLive), Effect.provide(DatabaseLive));
  return Effect.runPromise(program as Effect.Effect<T, never, never>);
}
import { TaskRunner } from './task-runner';
import { loadTasks, saveTasks } from './tasks-adapter';

const DEFAULT_MAX_STEPS = 200;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const TRADING_MAX_STEPS = 500;
const TRADING_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours

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

function pickAgentName(role: string, seed: string): string {
  const r = role.trim().toLowerCase();
  const pools: Record<string, string[]> = {
    manager: ['Atlas', 'Kernel', 'Director', 'Control'],
    browser: ['Orbit', 'Navigator', 'Relay', 'Pilot'],
    copy: ['Quill', 'Copydesk', 'Scribe', 'Draft'],
    design: ['Prism', 'Vector', 'Canvas', 'Studio'],
    research: ['Glyph', 'Index', 'Scout', 'Signal'],
    qa: ['Aegis', 'Verifier', 'Audit', 'Gate'],
    code: ['Forge', 'Compiler', 'Builder', 'Refactor'],
    agent: ['Node', 'Module', 'Echo', 'Nova'],
  };

  const pool =
    r === 'manager' || r === 'orchestrator'
      ? pools.manager
      : r === 'browser' || r === 'navigator'
        ? pools.browser
        : r === 'copy' || r === 'copywriter'
          ? pools.copy
          : r === 'design' || r === 'image' || r === 'imagen'
            ? pools.design
            : r === 'research' || r === 'investigator'
              ? pools.research
              : r === 'qa' || r === 'review'
                ? pools.qa
                : r === 'code' || r === 'dev'
                  ? pools.code
                  : pools.agent;

  const idx = hash32(seed) % pool.length;
  return pool[idx]!;
}

/** Per-runner concurrency limits */
const MAX_CONCURRENT: Record<string, number> = {
  browser: isPerTaskBrowserSessionMode(parseBrowserSessionMode()) ? 1 : 5,
  code: 10,
  cdp: isPerTaskBrowserSessionMode(parseBrowserSessionMode()) ? 1 : 5,
  orchestrator: 3,
};

export class TaskManager extends EventEmitter {
  private tasks = new Map<string, Task>();
  private runners = new Map<string, TaskRunner>();
  private inboxes = new Map<string, Array<{ from: string; message: string }>>();
  private agentDefs = new Map<string, AgentDefinition>();
  private persistPath: string;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private getPolicy: (() => PolicyState) | null = null;
  private agentRegistry: AgentRegistry | null;

  constructor(agentRegistry?: AgentRegistry) {
    super();
    this.agentRegistry = agentRegistry ?? null;
    this.persistPath = 'tasks-db'; // Tasks are now persisted via PostgreSQL
    // Load tasks after a short delay to let DB pool initialize
    setTimeout(() => void this.loadFromDisk(), 1000);
  }

  setPolicyGetter(fn: () => PolicyState): void {
    this.getPolicy = fn;
  }

  create(req: TaskCreateRequest): Task {
    const id = `task_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

    const agentRole = req.agentRole ?? (req.parentTaskId ? inferAgentRole(req.prompt) : undefined);
    const agentName = req.agentName ?? (req.parentTaskId ? pickAgentName(agentRole ?? 'Agent', id) : undefined);

    // Look up agent definition from registry
    let agentDef: AgentDefinition | undefined;
    if (req.agent && this.agentRegistry) {
      agentDef = this.agentRegistry.get(req.agent);
      if (!agentDef) {
        throw new Error(
          `Unknown agent: "${req.agent}". Available: ${this.agentRegistry
            .list()
            .map((a) => a.name)
            .join(', ')}`
        );
      }
    }

    const mode = agentDef?.mode ?? req.mode ?? 'code';
    const capabilities = agentDef?.capabilities ?? req.capabilities ?? [];

    const task: Task = {
      id,
      userId: (req as any).userId,
      parentTaskId: req.parentTaskId,
      agentName: agentName ?? agentDef?.description,
      agentRole,
      agent: req.agent,
      prompt: req.prompt,
      attachments: req.attachments,
      status: 'pending_approval',
      mode,
      runner: deriveRunner(mode, capabilities, req.orchestrate),
      capabilities,
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      maxSteps:
        req.maxSteps ?? agentDef?.maxSteps ?? (isTradingTask(capabilities) ? TRADING_MAX_STEPS : DEFAULT_MAX_STEPS),
      timeoutMs: req.timeoutMs ?? (isTradingTask(capabilities) ? TRADING_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
      source: req.source ?? 'desktop',
      model: req.model ?? agentDef?.model,
      skipMemory: req.skipMemory,
    };

    if (agentDef) {
      this.agentDefs.set(id, agentDef);
    }

    this.tasks.set(id, task);
    void this.persistToDisk();
    return task;
  }

  async approve(taskId: string): Promise<Task> {
    const task = this.getOrThrow(taskId);
    if (task.status !== 'pending_approval') {
      throw new Error(`Cannot approve task in status: ${task.status}`);
    }

    const running = [...this.runners.entries()].reduce(
      (acc, [id]) => {
        const t = this.tasks.get(id);
        if (!t) return acc;
        const key = t.runner ?? t.mode;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    const runnerKey = task.runner ?? task.mode;
    const limit = MAX_CONCURRENT[runnerKey] ?? MAX_CONCURRENT[task.mode] ?? 5;
    const current = running[runnerKey] ?? 0;
    if (current >= limit) {
      throw new Error(`Max ${limit} concurrent ${runnerKey} tasks. Wait for one to finish.`);
    }

    task.status = 'approved';
    task.updatedAt = Date.now();
    this.pushUpdate(task);

    task.status = 'running';
    task.updatedAt = Date.now();
    this.pushUpdate(task);

    const policy = this.getPolicy?.() ?? null;
    const provider = policy?.provider.active ?? 'chatgpt';
    const openaiModel = task.model ?? policy?.provider.openaiModel ?? 'gpt-4.1';

    const memoryEnabled = (policy?.taskMemoryEnabled ?? true) && !task.skipMemory;
    const memoryContext = memoryEnabled ? recallMemoriesFast(task.prompt, { limit: 5 }) : '';

    const facts = memoryEnabled
      ? await runTaskMemoryEffect(
          Effect.flatMap(TaskMemoryService, (service) => service.searchFacts(task.userId ?? 0, task.prompt, 10))
        )
      : [];
    const factsContext = memoryEnabled
      ? await runTaskMemoryEffect(
          Effect.flatMap(TaskMemoryService, (service) => Effect.sync(() => service.formatFactsForPrompt(facts)))
        )
      : '';

    const skills = await loadSkills();
    const skillContext = getActiveSkillPrompts(skills, task.prompt);

    const feedbackContext = memoryEnabled
      ? await runEvalFeedbackEffect(
          Effect.flatMap(EvalFeedbackService, (service) =>
            service.buildFeedbackContext(task.userId ?? 0, task.capabilities)
          )
        )
      : '';
    const paperMode = policy?.paperTradingEnabled ?? false;

    const agentDef = this.agentDefs.get(taskId);

    const runner = new TaskRunner(
      task,
      {
        provider,
        openaiModel,
        memoryContext: memoryContext + factsContext + skillContext + feedbackContext,
        taskManager: this,
        taskId: task.id,
        paperMode,
        agentSystemPrompt: agentDef?.systemPrompt,
        agentAllowedTools: agentDef?.allowedTools,
      },
      {
        onUpdate: (updated) => {
          this.tasks.set(updated.id, updated);
          this.pushUpdate(updated);
          this.schedulePersist();
        },
      }
    );

    this.runners.set(taskId, runner);

    const startTime = Date.now();

    void runner
      .run()
      .then(async (final) => {
        this.tasks.set(final.id, final);
        this.runners.delete(taskId);
        if (memoryEnabled) await this.extractAndSaveMemory(final, provider, Date.now() - startTime);
        await this.scoreTradeOutcome(final, Date.now() - startTime, paperMode);
        void this.persistToDisk();
      })
      .catch(async (e) => {
        task.status = 'failed';
        task.error = e instanceof Error ? e.message : String(e);
        task.updatedAt = Date.now();
        this.tasks.set(taskId, task);
        this.pushUpdate(task);
        this.runners.delete(taskId);
        if (memoryEnabled) await this.extractAndSaveMemory(task, provider, Date.now() - startTime);
        await this.scoreTradeOutcome(task, Date.now() - startTime, paperMode);
        void this.persistToDisk();
      });

    return task;
  }

  async spawnAndWait(
    prompt: string,
    parentCapabilities: TaskCapabilityId[],
    parentTaskId?: string,
    agentIdentity?: { agentName?: string; agentRole?: string }
  ): Promise<{
    taskId: string;
    status: Task['status'];
    output: string;
    summary?: string;
    error?: string;
  }> {
    const task = this.create({
      prompt,
      capabilities: parentCapabilities,
      parentTaskId,
      agentName: agentIdentity?.agentName,
      agentRole: agentIdentity?.agentRole,
    });

    await this.approve(task.id);

    const result = await new Promise<Task>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.cancel(task.id);
          reject(new Error('Sub-task timed out after 10 minutes'));
        },
        10 * 60 * 1000
      );

      const onUpdate = (updated: Task): void => {
        if (updated.id !== task.id) return;
        if (updated.status === 'completed' || updated.status === 'failed' || updated.status === 'cancelled') {
          clearTimeout(timeout);
          this.removeListener('taskUpdate', onUpdate);
          resolve(updated);
        }
      };
      this.on('taskUpdate', onUpdate);
    });

    const doneStep = [...result.steps].reverse().find((s) => (s.action as any)?.type === 'done') as
      | (import('../../types').TaskStep & { action: { type: 'done'; summary: string } })
      | undefined;

    const doneSummary = doneStep?.action?.summary;
    const status = result.status;
    const output =
      status === 'completed'
        ? (doneSummary ?? result.summary ?? '')
        : (result.error ?? doneSummary ?? result.summary ?? '');

    return {
      taskId: result.id,
      status,
      output: output || `Sub-task ${status}`,
      summary: result.summary ?? undefined,
      error: result.error ?? undefined,
    };
  }

  /**
   * Non-blocking spawn: creates + approves a child task, returns its ID immediately.
   * The caller can later use waitForTasks([childId]) to join.
   */
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
      skipMemory: true, // Orchestrator already gave context in the prompt
    });

    await this.approve(task.id);

    return { taskId: task.id };
  }

  /**
   * Wait for one or more tasks to reach a terminal status.
   * Returns results for all requested task IDs (including failures/timeouts).
   */
  async waitForTasks(
    taskIds: string[],
    timeoutMs: number
  ): Promise<Array<{ taskId: string; status: Task['status']; summary?: string; error?: string }>> {
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
              results.push({ taskId: id, status: 'failed', error: `Task ${id} wait timed out` });
              resolve();
            }, timeoutMs);

            const onUpdate = (updated: Task): void => {
              if (updated.id !== id) return;
              if (TERMINAL.has(updated.status)) {
                clearTimeout(timer);
                this.removeListener('taskUpdate', onUpdate);
                results.push({
                  taskId: id,
                  status: updated.status,
                  summary: updated.summary,
                  error: updated.error,
                });
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
    if (target.status !== 'running') throw new Error(`Task ${targetTaskId} is not running (status: ${target.status})`);

    let inbox = this.inboxes.get(targetTaskId);
    if (!inbox) {
      inbox = [];
      this.inboxes.set(targetTaskId, inbox);
    }
    inbox.push({ from: fromTaskId, message });

    const task = this.tasks.get(targetTaskId)!;
    task.steps.push({
      index: task.steps.length,
      timestamp: Date.now(),
      screenshotBase64: '',
      action: { type: 'user_message' as const, text: message },
    });
    task.updatedAt = Date.now();
    this.pushUpdate(task);
  }

  drainMessages(taskId: string): Array<{ from: string; message: string }> {
    const inbox = this.inboxes.get(taskId);
    if (!inbox || inbox.length === 0) return [];
    this.inboxes.set(taskId, []);
    return inbox;
  }

  /**
   * Resume a completed/failed/cancelled task with a new user message.
   * Appends the message as a user_message step and re-runs the task,
   * preserving all previous context (steps, prompt, capabilities).
   */
  async resume(taskId: string, message: string): Promise<Task> {
    const task = this.getOrThrow(taskId);
    const terminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
    if (!terminal) throw new Error(`Task ${taskId} is still ${task.status}, use sendMessage instead`);
    if (this.runners.has(taskId)) throw new Error(`Task ${taskId} already has an active runner`);

    // Build conversation context from previous steps (kept separate from task.prompt)
    const conversationLines: string[] = [];
    for (const step of task.steps) {
      const actionData = step.action as Record<string, unknown>;
      if (step.action.type === 'user_message' && actionData.text) {
        conversationLines.push(`[USER]: ${String(actionData.text)}`);
      } else if (step.action.type === 'done' && actionData.summary) {
        conversationLines.push(`[AGENT]: ${String(actionData.summary)}`);
      } else if (step.action.type === 'fail' && actionData.reason) {
        conversationLines.push(`[AGENT FAILED]: ${String(actionData.reason)}`);
      }
    }
    conversationLines.push(`[USER]: ${message}`);

    // Store conversation context on the task for the runner to pick up
    (task as Record<string, unknown>).resumeContext =
      `\n\n[PRIOR CONVERSATION — do NOT repeat questions already answered]\n${conversationLines.join('\n')}\n[/PRIOR CONVERSATION]\nContinue from where you left off.`;

    // Add the user message as a visible step (keeps chat history in UI)
    task.steps.push({
      index: task.steps.length,
      timestamp: Date.now(),
      screenshotBase64: '',
      action: { type: 'user_message' as const, text: message },
    });
    task.error = undefined;
    task.status = 'running';
    task.updatedAt = Date.now();
    this.tasks.set(taskId, task);
    this.pushUpdate(task);

    // Re-launch the runner (same logic as approve)
    const policy = this.getPolicy?.() ?? null;
    const provider = policy?.provider.active ?? 'chatgpt';
    const openaiModel = task.model ?? policy?.provider.openaiModel ?? 'gpt-4.1';

    const memoryEnabled = (policy?.taskMemoryEnabled ?? true) && !task.skipMemory;
    const memoryContext = memoryEnabled ? recallMemoriesFast(task.prompt, { limit: 5 }) : '';

    const facts = memoryEnabled
      ? await runTaskMemoryEffect(
          Effect.flatMap(TaskMemoryService, (service) => service.searchFacts(task.userId ?? 0, task.prompt, 10))
        )
      : [];
    const factsContext = memoryEnabled
      ? await runTaskMemoryEffect(
          Effect.flatMap(TaskMemoryService, (service) => Effect.sync(() => service.formatFactsForPrompt(facts)))
        )
      : '';

    const skills = await loadSkills();
    const skillContext = getActiveSkillPrompts(skills, task.prompt);

    const feedbackContext = memoryEnabled
      ? await runEvalFeedbackEffect(
          Effect.flatMap(EvalFeedbackService, (service) =>
            service.buildFeedbackContext(task.userId ?? 0, task.capabilities)
          )
        )
      : '';
    const paperMode = policy?.paperTradingEnabled ?? false;

    const runner = new TaskRunner(
      task,
      {
        provider,
        openaiModel,
        memoryContext:
          memoryContext +
          factsContext +
          skillContext +
          feedbackContext +
          (((task as Record<string, unknown>).resumeContext as string) ?? ''),
        taskManager: this,
        taskId: task.id,
        paperMode,
      },
      {
        onUpdate: (updated) => {
          this.tasks.set(updated.id, updated);
          this.pushUpdate(updated);
          this.schedulePersist();
        },
      }
    );

    // Clean up the temporary resumeContext so it doesn't persist
    (task as Record<string, unknown>).resumeContext = undefined;

    this.runners.set(taskId, runner);
    const startTime = Date.now();

    void runner
      .run()
      .then(async (final) => {
        this.tasks.set(final.id, final);
        this.runners.delete(taskId);
        if (memoryEnabled) await this.extractAndSaveMemory(final, provider, Date.now() - startTime);
        await this.scoreTradeOutcome(final, Date.now() - startTime, paperMode);
        void this.persistToDisk();
      })
      .catch(async (e) => {
        task.status = 'failed';
        task.error = e instanceof Error ? e.message : String(e);
        task.updatedAt = Date.now();
        this.tasks.set(taskId, task);
        this.pushUpdate(task);
        this.runners.delete(taskId);
        if (memoryEnabled) await this.extractAndSaveMemory(task, provider, Date.now() - startTime);
        await this.scoreTradeOutcome(task, Date.now() - startTime, paperMode);
        void this.persistToDisk();
      });

    return task;
  }

  cancel(taskId: string, reason = 'Cancelled by user'): Task {
    const task = this.getOrThrow(taskId);

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return task;
    }

    const runner = this.runners.get(taskId);
    if (runner) {
      runner.abort(reason);
      this.runners.delete(taskId);
      const latest = runner.getTask();
      const finalReason = latest.error;
      if (finalReason) {
        task.error = finalReason;
      }
    }

    task.status = 'cancelled';
    if (!task.error) task.error = reason;
    task.updatedAt = Date.now();
    this.tasks.set(taskId, task);
    this.pushUpdate(task);
    void this.persistToDisk();
    return task;
  }

  delete(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const runner = this.runners.get(taskId);
    if (runner) {
      runner.abort('Deleted by user');
      this.runners.delete(taskId);
    }

    this.tasks.delete(taskId);
    this.agentDefs.delete(taskId);
    void this.persistToDisk();
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  list(userId?: number): Task[] {
    const all = [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
    if (userId !== undefined) {
      return all.filter((t) => t.userId === userId || t.userId === undefined);
    }
    return all;
  }

  /** Get the agent definition for a task (if it was created with one). */
  getAgentDef(taskId: string): AgentDefinition | undefined {
    return this.agentDefs.get(taskId);
  }

  /**
   * Mark all running tasks as shutting_down.
   * Returns the number of tasks affected.
   */
  markShuttingDown(): number {
    let count = 0;
    for (const [id, task] of this.tasks) {
      if (task.status === 'running') {
        task.status = 'shutting_down';
        task.updatedAt = Date.now();
        this.tasks.set(id, task);
        this.pushUpdate(task);
        count++;
      }
    }
    this.persistToDiskSync();
    return count;
  }

  /**
   * Get the number of active (running or shutting_down) tasks.
   */
  getActiveTaskCount(): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'running' || task.status === 'shutting_down') {
        count++;
      }
    }
    return count;
  }

  /**
   * Wait for all active tasks to complete or reach a terminal state.
   * @param timeoutMs Maximum time to wait in milliseconds
   * @returns true if all tasks completed, false if timeout
   */
  async waitForAllTasks(timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 500; // Check every 500ms

    while (Date.now() - startTime < timeoutMs) {
      const activeCount = this.getActiveTaskCount();
      if (activeCount === 0) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    return false; // Timeout
  }

  destroyAll(): void {
    for (const [id, runner] of this.runners) {
      runner.abort('App shutting down');
      this.runners.delete(id);

      const task = this.tasks.get(id);
      if (task && (task.status === 'running' || task.status === 'shutting_down')) {
        task.status = 'cancelled';
        task.error = 'App shutting down';
        task.updatedAt = Date.now();
        this.tasks.set(id, task);
        this.pushUpdate(task);
      }
    }
    this.persistToDiskSync();
  }

  private async extractAndSaveMemory(task: Task, provider: string, durationMs: number): Promise<void> {
    if (task.status !== 'completed' && task.status !== 'failed') return;

    const outcome = task.status === 'completed' ? 'completed' : 'failed';
    const summary = task.summary ?? task.error ?? 'No summary';

    const selectors: string[] = [];
    const urls: string[] = [];
    const failedActions: string[] = [];
    const successHints: string[] = [];

    for (const step of task.steps) {
      const raw = step.action as Record<string, unknown>;
      const type = raw.type as string;

      if ((type === 'click' || type === 'type' || type === 'upload_file') && raw.selector) {
        const sel = String(raw.selector);
        if (!step.error && !selectors.includes(sel)) {
          selectors.push(sel);
        }
      }

      if (type === 'navigate' && raw.url) {
        const u = String(raw.url);
        if (!urls.includes(u)) urls.push(u);
      }

      if (step.error) {
        failedActions.push(`${type}${raw.selector ? ` on "${raw.selector}"` : ''}: ${step.error.slice(0, 120)}`);
      }

      if (step.thought && !step.error) {
        const t = step.thought;
        if (t.length > 20 && t.length < 300 && /found|discover|work|success|correct|need to|should|instead/i.test(t)) {
          const hint = t.slice(0, 200);
          if (successHints.length < 3) successHints.push(hint);
        }
      }
    }

    const parts: string[] = [
      `Outcome: ${summary}. Steps: ${task.steps.length}. Duration: ${Math.round(durationMs / 1000)}s.`,
    ];

    if (urls.length > 0) parts.push(`URLs: ${urls.slice(0, 5).join(', ')}`);
    if (selectors.length > 0) parts.push(`Working selectors: ${selectors.slice(0, 10).join(' | ')}`);
    if (failedActions.length > 0) parts.push(`Failed: ${failedActions.slice(0, 5).join('; ')}`);
    if (successHints.length > 0) parts.push(`Insights: ${successHints.join(' | ')}`);

    await runTaskMemoryEffect(
      Effect.flatMap(TaskMemoryService, (service) =>
        service.saveMemory(task.userId ?? 0, {
          taskId: task.id,
          prompt: task.prompt,
          outcome,
          learnings: parts.join('\n'),
          provider,
          durationMs,
        })
      )
    );
  }

  private async scoreTradeOutcome(task: Task, durationMs: number, isPaper: boolean): Promise<void> {
    try {
      // Extract trades using the service
      const extracted = await runEvalFeedbackEffect(
        Effect.flatMap(EvalFeedbackService, (service) => service.extractTradesFromTask(task))
      );
      if (!extracted) return;

      // Save trade score using the service
      // Map task status to valid ScoreInput status (filter out non-terminal statuses)
      const validStatuses = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const;
      const taskStatus = validStatuses.includes(task.status as (typeof validStatuses)[number])
        ? (task.status as (typeof validStatuses)[number])
        : 'pending';

      await runEvalFeedbackEffect(
        Effect.flatMap(EvalFeedbackService, (service) =>
          service.saveTradeScore({
            userId: task.userId ?? 0,
            taskId: task.id,
            taskStatus,
            taskSteps: task.steps.map((s) => ({ action: { type: s.action.type }, result: s.result })),
            taskMaxSteps: task.maxSteps,
            venue: extracted.venue,
            capability: extracted.capability,
            trades: extracted.trades,
            durationMs,
            isPaper,
            hadOpenPositionsAtDone: extracted.hadOpenPositionsAtDone,
          })
        )
      );
    } catch {
      // Non-critical
    }
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

  // ── Persistence (PostgreSQL via TasksService) ─────────────────────────

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistToDisk();
    }, 2000);
  }

  private async persistToDisk(): Promise<void> {
    try {
      const stripped = this.buildStripped();
      await saveTasks(stripped as Task[]);
    } catch {
      // Non-critical
    }
  }

  private persistToDiskSync(): void {
    // Fire-and-forget async save (no sync fs needed with PostgreSQL)
    void this.persistToDisk();
  }

  private buildStripped(): object[] {
    return this.list().map((t) => ({
      ...t,
      steps: t.steps.map((s) => ({ ...s, screenshotBase64: '' })),
    }));
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const loaded = await loadTasks();
      if (!Array.isArray(loaded) || loaded.length === 0) return;

      for (const task of loaded) {
        // Backfill runner for older persisted tasks.
        if (!(task as any).runner) {
          const mode = (task.mode ?? 'browser') as TaskMode;
          const caps = (task.capabilities ?? []) as TaskCapabilityId[];
          (task as any).runner = deriveRunner(mode, caps);
        }
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
          this.tasks.set(task.id, task);
        } else {
          task.status = 'failed';
          task.error = 'Interrupted by server restart';
          task.updatedAt = Date.now();
          this.tasks.set(task.id, task);
        }
      }
    } catch {
      // No tasks or error — start fresh
    }
  }

  private async cleanupTaskProcesses(taskId: string): Promise<void> {
    try {
      const { getProcessRegistry } = await import('./process-registry');
      const registry = getProcessRegistry();
      const result = registry.cleanupTask(taskId);
      if (result.killed > 0) {
        console.log(`[TaskManager] Cleaned up ${result.killed} background processes for task ${taskId}`);
      }
    } catch (error) {
      console.error(`[TaskManager] Error cleaning up processes for task ${taskId}:`, error);
    }
  }
}

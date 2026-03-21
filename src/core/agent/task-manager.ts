/**
 * TaskManager — CRUD for tasks + orchestrates TaskRunners.
 * Server-side version: uses broadcast() instead of Electron BrowserWindow.
 */

import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import type { PolicyState, Task, TaskCapabilityId, TaskCreateRequest, TaskMode } from '../../types';
import { broadcast } from '../../ws/events';
import { isPerTaskBrowserSessionMode, parseBrowserSessionMode } from '../browser/session-mode';
import { getDataDir } from '../config';
import { getActiveSkillPrompts, loadSkills } from '../stores/skill-store';
import {
  closeMemoryDb,
  formatFactsForPrompt,
  formatMemoriesForPrompt,
  saveMemory,
  searchFacts,
  searchMemories,
} from './task-memory';
import { deriveRunner } from './task-routing';
import { TaskRunner } from './task-runner';

const DEFAULT_MAX_STEPS = 200;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

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

/** Per-mode concurrency limits */
const MAX_CONCURRENT: Record<TaskMode, number> = {
  browser: isPerTaskBrowserSessionMode(parseBrowserSessionMode()) ? 1 : 5,
  code: 10,
};

export class TaskManager extends EventEmitter {
  private tasks = new Map<string, Task>();
  private runners = new Map<string, TaskRunner>();
  private inboxes = new Map<string, Array<{ from: string; message: string }>>();
  private persistPath: string;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private getPolicy: (() => PolicyState) | null = null;

  constructor() {
    super();
    this.persistPath = join(getDataDir(), 'tasks.json');
    void this.loadFromDisk();
  }

  setPolicyGetter(fn: () => PolicyState): void {
    this.getPolicy = fn;
  }

  create(req: TaskCreateRequest): Task {
    const id = `task_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

    const agentRole = req.agentRole ?? (req.parentTaskId ? inferAgentRole(req.prompt) : undefined);
    const agentName = req.agentName ?? (req.parentTaskId ? pickAgentName(agentRole ?? 'Agent', id) : undefined);

    const mode = req.mode ?? 'code';
    const capabilities = req.capabilities ?? [];

    const task: Task = {
      id,
      parentTaskId: req.parentTaskId,
      agentName,
      agentRole,
      prompt: req.prompt,
      attachments: req.attachments,
      status: 'pending_approval',
      mode,
      runner: deriveRunner(mode, capabilities),
      capabilities,
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      maxSteps: req.maxSteps ?? DEFAULT_MAX_STEPS,
      timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      source: req.source ?? 'desktop',
    };
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
        acc[t.mode] = (acc[t.mode] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    const limit = MAX_CONCURRENT[task.mode];
    const current = running[task.mode] ?? 0;
    if (current >= limit) {
      throw new Error(`Max ${limit} concurrent ${task.mode} tasks. Wait for one to finish.`);
    }

    task.status = 'approved';
    task.updatedAt = Date.now();
    this.pushUpdate(task);

    task.status = 'running';
    task.updatedAt = Date.now();
    this.pushUpdate(task);

    const policy = this.getPolicy?.() ?? null;
    const provider = policy?.provider.active ?? 'chatgpt';
    const openaiModel = policy?.provider.openaiModel ?? 'gpt-4.1';

    const memoryEnabled = policy?.taskMemoryEnabled ?? true;
    const memories = memoryEnabled ? searchMemories(task.prompt) : [];
    const memoryContext = formatMemoriesForPrompt(memories);

    const facts = memoryEnabled ? searchFacts(task.prompt) : [];
    const factsContext = formatFactsForPrompt(facts);

    const skills = await loadSkills();
    const skillContext = getActiveSkillPrompts(skills, task.prompt);

    const runner = new TaskRunner(
      task,
      {
        provider,
        openaiModel,
        memoryContext: memoryContext + factsContext + skillContext,
        taskManager: this,
        taskId: task.id,
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
      .then((final) => {
        this.tasks.set(final.id, final);
        this.runners.delete(taskId);
        if (memoryEnabled) this.extractAndSaveMemory(final, provider, Date.now() - startTime);
        void this.persistToDisk();
      })
      .catch((e) => {
        task.status = 'failed';
        task.error = e instanceof Error ? e.message : String(e);
        task.updatedAt = Date.now();
        this.tasks.set(taskId, task);
        this.pushUpdate(task);
        this.runners.delete(taskId);
        if (memoryEnabled) this.extractAndSaveMemory(task, provider, Date.now() - startTime);
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
    void this.persistToDisk();
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  destroyAll(): void {
    for (const [id, runner] of this.runners) {
      runner.abort('App shutting down');
      this.runners.delete(id);

      const task = this.tasks.get(id);
      if (task && task.status === 'running') {
        task.status = 'cancelled';
        task.error = 'App shutting down';
        task.updatedAt = Date.now();
        this.tasks.set(id, task);
        this.pushUpdate(task);
      }
    }
    this.persistToDiskSync();
    closeMemoryDb();
  }

  private extractAndSaveMemory(task: Task, provider: string, durationMs: number): void {
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

    saveMemory({
      taskId: task.id,
      prompt: task.prompt,
      outcome,
      learnings: parts.join('\n'),
      provider,
      durationMs,
    });
  }

  private getOrThrow(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  private pushUpdate(task: Task): void {
    // Broadcast via WebSocket instead of Electron IPC
    broadcast({ type: 'task:update', payload: { task } });
    this.emit('taskUpdate', task);
  }

  // ── Persistence ─────────────────────────────────────────────────────

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
      await mkdir(dirname(this.persistPath), { recursive: true });
      await writeFile(this.persistPath, JSON.stringify(stripped, null, 2), 'utf8');
    } catch {
      // Non-critical
    }
  }

  private persistToDiskSync(): void {
    try {
      const stripped = this.buildStripped();
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(this.persistPath, JSON.stringify(stripped, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }

  private buildStripped(): object[] {
    return this.list().map((t) => ({
      ...t,
      steps: t.steps.map((s) => ({ ...s, screenshotBase64: '' })),
    }));
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const raw = await readFile(this.persistPath, 'utf8');
      const loaded = JSON.parse(raw) as Task[];
      if (!Array.isArray(loaded)) return;

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
      // No file or invalid JSON — start fresh
    }
  }
}

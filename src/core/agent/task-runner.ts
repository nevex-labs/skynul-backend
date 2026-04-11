/**
 * TaskRunner — thin orchestrator for agent task execution.
 *
 * Delegates to mode-specific loops (browser, code, CDP) for the actual
 * iteration logic and action execution.
 */

import { AppBridge } from '../../capabilities/desktop/app-bridge';
import type { ProviderId, Task } from '../../types';
import type { BrowserEngine } from '../browser/engine/browser-engine';
import type { ExecutorContext } from './action-executors';
import { runAgentLoop } from './loops/agent-loop';
import { executeBrowserAction, setupBrowserLoop } from './loops/browser-loop';
import { executeApiOnlyAction, setupCdpLoop } from './loops/cdp-loop';
import { executeCodeAction, setupCodeLoop } from './loops/code-loop';
import { executeOrchestratorAction, setupOrchestratorLoop } from './loops/orchestrator-loop';
import type { TaskManager } from './task-manager';
import { deriveRunner } from './task-routing';

export type TaskRunnerCallbacks = {
  onUpdate: (task: Task) => void;
};

export type TaskRunnerOpts = {
  provider: ProviderId;
  model: string;
  memoryContext?: string;
  taskManager?: TaskManager | null;
  taskId?: string;
  paperMode?: boolean;
};

export class TaskRunner {
  private aborted = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private task: Task;
  private appBridge = new AppBridge();
  private lastScrapeData = '';
  private activeRelease: (() => Promise<void>) | null = null;

  private get executorCtx(): ExecutorContext {
    return {
      task: this.task,
      taskManager: this.opts.taskManager ?? null,
      appBridge: this.appBridge,
      pushUpdate: () => this.pushUpdate(),
      pushStatus: (msg) => this.pushStatus(msg),
      paperMode: this.opts.paperMode,
    };
  }

  constructor(
    task: Task,
    private opts: TaskRunnerOpts,
    private callbacks: TaskRunnerCallbacks
  ) {
    this.task = { ...task };
  }

  async run(): Promise<Task> {
    this.timeoutHandle = setTimeout(() => this.abort('Task timed out'), this.task.timeoutMs);

    const runner = this.task.runner ?? deriveRunner(this.task.mode, this.task.capabilities);
    if (runner === 'orchestrator') return this.runOrchestrator();
    if (runner === 'sandbox') return this.runCode();
    if (runner === 'cdp') return this.runCdp();
    return this.runBrowser();
  }

  private async runOrchestrator(): Promise<Task> {
    console.log('[runner] starting orchestrator');
    const deps = {
      task: this.task,
      memoryContext: this.opts.memoryContext,
      taskManager: this.opts.taskManager ?? null,
      maxSteps: this.task.maxSteps,
      paperMode: this.opts.paperMode,
    };

    const { systemPrompt, systemPromptCompact, history, callbacks } = setupOrchestratorLoop({
      deps,
      onStatus: (msg) => this.pushStatus(msg),
      onUpdate: (t) => this.callbacks.onUpdate(t),
      isAborted: () => this.aborted,
    });

    callbacks.executeAction = (action) => executeOrchestratorAction(this.executorCtx, action);

    return runAgentLoop(
      systemPrompt,
      history,
      this.task.maxSteps,
      this.task,
      this.opts.provider,
      this.opts.model,
      callbacks,
      undefined,
      systemPromptCompact
    );
  }

  private async cleanupBrowserRelease(release: (() => Promise<void>) | null): Promise<void> {
    if (release) await release().catch(() => {});
    if (this.activeRelease === release) this.activeRelease = null;
  }

  private async runBrowser(): Promise<Task> {
    let engine: BrowserEngine | undefined;
    let release: (() => Promise<void>) | null = null;

    const deps = {
      task: this.task,
      memoryContext: this.opts.memoryContext,
      taskManager: this.opts.taskManager ?? null,
      parentTaskId: this.task.parentTaskId,
      maxSteps: this.task.maxSteps,
      paperMode: this.opts.paperMode,
    };

    let loopResult: Task;
    try {
      const {
        engine: e,
        release: r,
        systemPrompt,
        systemPromptCompact,
        history,
        callbacks,
      } = await setupBrowserLoop({
        deps,
        onStatus: (msg) => this.pushStatus(msg),
        onUpdate: (t) => this.callbacks.onUpdate(t),
        isAborted: () => this.aborted,
      });
      engine = e;
      release = r;
      this.activeRelease = release;

      callbacks.executeAction = (action) => {
        if (!engine) throw new Error('Browser engine not initialized');
        return executeBrowserAction(engine, action, this.executorCtx);
      };
      loopResult = await runAgentLoop(
        systemPrompt,
        history,
        this.task.maxSteps,
        this.task,
        this.opts.provider,
        this.opts.model,
        callbacks,
        undefined,
        systemPromptCompact
      );
    } catch (e) {
      await this.cleanupBrowserRelease(release);
      if ((e as any)?.__cancelled || this.aborted) return this.finish('cancelled', this.task.error);
      return this.finish('failed', `Browser loop error: ${e instanceof Error ? e.message : String(e)}`);
    }

    await this.cleanupBrowserRelease(release);
    return loopResult;
  }

  private async runCdp(): Promise<Task> {
    const deps = {
      task: this.task,
      memoryContext: this.opts.memoryContext,
      taskManager: this.opts.taskManager ?? null,
      parentTaskId: this.task.parentTaskId,
      maxSteps: this.task.maxSteps,
      paperMode: this.opts.paperMode,
    };

    const { systemPrompt, systemPromptCompact, history, callbacks } = setupCdpLoop({
      deps,
      onStatus: (msg) => this.pushStatus(msg),
      onUpdate: (t) => this.callbacks.onUpdate(t),
      isAborted: () => this.aborted,
    });

    callbacks.executeAction = (action) => executeApiOnlyAction(action, this.executorCtx);

    return runAgentLoop(
      systemPrompt,
      history,
      this.task.maxSteps,
      this.task,
      this.opts.provider,
      this.opts.model,
      callbacks,
      undefined,
      systemPromptCompact
    );
  }

  private async runCode(): Promise<Task> {
    console.log('[runner] starting code mode, provider=', this.opts.provider, 'model=', this.opts.model);
    const deps = {
      task: this.task,
      memoryContext: this.opts.memoryContext,
      taskManager: this.opts.taskManager ?? null,
      parentTaskId: this.task.parentTaskId,
      maxSteps: this.task.maxSteps,
    };

    const { systemPrompt, systemPromptCompact, history, callbacks } = setupCodeLoop({
      deps,
      onStatus: (msg) => this.pushStatus(msg),
      onUpdate: (t) => this.callbacks.onUpdate(t),
      isAborted: () => this.aborted,
    });

    const scrapeState = { lastScrapeData: this.lastScrapeData };
    callbacks.executeAction = (action) => executeCodeAction(action, this.executorCtx, scrapeState);

    return runAgentLoop(
      systemPrompt,
      history,
      this.task.maxSteps,
      this.task,
      this.opts.provider,
      this.opts.model,
      callbacks,
      undefined,
      systemPromptCompact
    );
  }

  abort(reason?: string): void {
    // Don't abort tasks that are being monitored by the system
    if (this.task.status === 'monitoring') return;
    this.aborted = true;
    if (reason) this.task.error = reason;
    // eslint-disable-next-line no-console
    console.log(`[task] abort: ${this.task.id}${reason ? ` — ${reason}` : ''}`);
    // Best-effort: close active browser page early to stop Playwright work.
    // (We still rely on the loop's isAborted() checks to stop future model calls.)
    const rel = this.activeRelease;
    this.activeRelease = null;
    if (rel) {
      void rel().catch(() => {});
    }
    this.cleanup();
  }

  private finish(status: 'completed' | 'failed' | 'cancelled', error?: string): Task {
    this.cleanup();
    this.task.status = status;
    if (error) this.task.error = error;
    this.task.updatedAt = Date.now();
    this.pushUpdate();
    return this.task;
  }

  private cleanup(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  private pushUpdate(): void {
    this.task.updatedAt = Date.now();
    this.callbacks.onUpdate({ ...this.task });
  }

  private pushStatus(msg: string): void {
    this.task.summary = msg;
    this.pushUpdate();
  }

  getTask(): Task {
    return { ...this.task };
  }
}

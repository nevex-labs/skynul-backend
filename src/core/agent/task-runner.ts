/**
 * TaskRunner — thin orchestrator for agent task execution.
 *
 * Delegates to mode-specific loops (browser, code, CDP) for the actual
 * iteration logic and action execution.
 */

import type { ProviderId, Task } from '../../types';
import type { BrowserEngine } from '../browser/engine/browser-engine';
import type { ExecutorContext } from './action-executors';
import { AppBridge } from './app-bridge';
import { runAgentLoop } from './loops/agent-loop';
import { executeBrowserAction, setupBrowserLoop } from './loops/browser-loop';
import { executeApiOnlyAction, setupCdpLoop } from './loops/cdp-loop';
import { executeCodeAction, setupCodeLoop } from './loops/code-loop';

export type TaskRunnerCallbacks = {
  onUpdate: (task: Task) => void;
};

export type TaskRunnerOpts = {
  provider: ProviderId;
  openaiModel: string;
  memoryContext?: string;
  taskManager?: import('./task-manager').TaskManager | null;
  taskId?: string;
};

export class TaskRunner {
  private aborted = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private task: Task;
  private appBridge = new AppBridge();
  private lastScrapeData = '';

  private get executorCtx(): ExecutorContext {
    return {
      task: this.task,
      taskManager: this.opts.taskManager ?? null,
      appBridge: this.appBridge,
      pushUpdate: () => this.pushUpdate(),
      pushStatus: (msg) => this.pushStatus(msg),
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

    if (this.task.mode === 'code') return this.runCode();
    if (this.task.capabilities.includes('polymarket.trading')) return this.runCdp();
    return this.runBrowser();
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
    };

    let loopResult: Task;
    try {
      const {
        engine: e,
        release: r,
        systemPrompt,
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

      callbacks.executeAction = (action) => executeBrowserAction(engine!, action, this.executorCtx);
      loopResult = await runAgentLoop(
        systemPrompt,
        history,
        this.task.maxSteps,
        this.task,
        this.opts.provider,
        this.opts.openaiModel,
        callbacks
      );
    } catch (e) {
      if (release) await release().catch(() => {});
      if ((e as any)?.__cancelled || this.aborted) return this.finish('cancelled');
      return this.finish('failed', `Browser loop error: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (release) await release().catch(() => {});
    return loopResult;
  }

  private async runCdp(): Promise<Task> {
    const deps = {
      task: this.task,
      memoryContext: this.opts.memoryContext,
      taskManager: this.opts.taskManager ?? null,
      parentTaskId: this.task.parentTaskId,
      maxSteps: this.task.maxSteps,
    };

    const { systemPrompt, history, callbacks } = setupCdpLoop({
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
      this.opts.openaiModel,
      callbacks
    );
  }

  private async runCode(): Promise<Task> {
    const deps = {
      task: this.task,
      memoryContext: this.opts.memoryContext,
      taskManager: this.opts.taskManager ?? null,
      parentTaskId: this.task.parentTaskId,
      maxSteps: this.task.maxSteps,
    };

    const { systemPrompt, history, callbacks } = setupCodeLoop({
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
      this.opts.openaiModel,
      callbacks
    );
  }

  abort(reason?: string): void {
    this.aborted = true;
    if (reason) this.task.error = reason;
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

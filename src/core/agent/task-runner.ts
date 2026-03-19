/**
 * TaskRunner — the agent loop for a single task.
 *
 * 1. Create WindowsBridge
 * 2. Screenshot → send to model with history
 * 3. Model responds with JSON action
 * 4. Execute action via bridge
 * 5. Record step (screenshot + action + result)
 * 6. Push update to renderer
 * 7. Repeat until done, fail, timeout, or max steps
 */

import type { ProviderId, Task, TaskAction } from '../../types';
import type { BrowserEngine } from '../browser/engine/browser-engine';
import { type VisionMessage } from '../providers/codex-vision';
import {
  type ExecutorContext,
  executeFactAction,
  executeFileEdit,
  executeFileList,
  executeFileRead,
  executeFileSearch,
  executeFileWrite,
  executeGenerateImage,
  executeInterTaskAction,
  executePolymarketAction,
  executeSetIdentity,
  executeShell,
  headTail,
  resolveAttachments,
} from './action-executors';
import { compressHistory, drainInbox } from './history-manager';
import { AppBridge } from './app-bridge';
import { createExcelFromTsv } from './excel-writer';
import { scrapeUrl } from './web-scraper';
import { runAgentLoop } from './loops/agent-loop';
import { setupBrowserLoop } from './loops/browser-loop';
import { setupCdpLoop } from './loops/cdp-loop';
import { setupCodeLoop } from './loops/code-loop';

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
  private usageTotals: { inputTokens: number; outputTokens: number } | null = null;
  private appBridge = new AppBridge();

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
      const { engine: e, release: r, systemPrompt, history, callbacks } = await setupBrowserLoop({
        deps,
        onStatus: (msg) => this.pushStatus(msg),
        onUpdate: (t) => this.callbacks.onUpdate(t),
        isAborted: () => this.aborted,
      });
      engine = e;
      release = r;

      callbacks.executeAction = (action) => this.executeBrowserAction(engine!, action);
      loopResult = await runAgentLoop(
        systemPrompt,
        history,
        this.task.maxSteps,
        this.task,
        this.opts.provider,
        this.opts.openaiModel,
        callbacks,
      );
    } catch (e) {
      if (release) await release().catch(() => {});
      if ((e as any)?.['__cancelled'] || this.aborted) return this.finish('cancelled');
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

    callbacks.executeAction = (action) => this.executeApiOnlyAction(action);

    return runAgentLoop(
      systemPrompt,
      history,
      this.task.maxSteps,
      this.task,
      this.opts.provider,
      this.opts.openaiModel,
      callbacks,
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

    callbacks.executeAction = (action) => this.executeCodeAction(action);

    return runAgentLoop(
      systemPrompt,
      history,
      this.task.maxSteps,
      this.task,
      this.opts.provider,
      this.opts.openaiModel,
      callbacks,
    );
  }

  private async executeBrowserAction(engine: BrowserEngine, action: TaskAction): Promise<string | undefined> {
    const raw = action as Record<string, unknown>;
    const type = raw.type as string;
    const frameId = raw.frameId as string | undefined;

    switch (type) {
      case 'navigate': {
        const navUrl = String(raw.url ?? '');
        const IMAGE_GEN_SITES = [
          { keywords: ['pollinations'], domains: ['pollinations.ai'] },
          { keywords: ['bing image', 'bing create'], domains: ['bing.com/images/create', 'bing.com/create'] },
          { keywords: ['craiyon'], domains: ['craiyon.com'] },
          { keywords: ['nightcafe'], domains: ['nightcafe.studio'] },
          { keywords: ['leonardo'], domains: ['leonardo.ai'] },
          { keywords: ['ideogram'], domains: ['ideogram.ai'] },
          { keywords: ['firefly'], domains: ['adobe.com/firefly'] },
          { keywords: ['dream.ai'], domains: ['dream.ai'] },
        ];
        const promptLower = this.task.prompt.toLowerCase();
        const matchedSite = IMAGE_GEN_SITES.find((s) => s.domains.some((d) => navUrl.includes(d)));
        if (matchedSite) {
          if (!matchedSite.keywords.some((k) => promptLower.includes(k))) {
            return `[BLOCKED] Do not navigate to image generation websites. Use the generate_image action instead.`;
          }
        }
        await engine.navigate(navUrl);
        await this.sleep(1500);
        return undefined;
      }
      case 'click':
        await engine.click(raw.selector as string, frameId);
        return undefined;
      case 'type':
        await engine.type(raw.selector as string, raw.text as string, frameId);
        return undefined;
      case 'pressKey':
        await engine.pressKey(raw.key as string);
        return undefined;
      case 'key':
        await engine.pressKey((raw.key as string) || (raw.combo as string));
        return undefined;
      case 'evaluate': {
        const result = await engine.evaluate(raw.script as string, frameId);
        return result || undefined;
      }
      case 'upload_file': {
        const selector = raw.selector as string;
        const filePaths = raw.filePaths as string[];
        if (!selector || !Array.isArray(filePaths) || filePaths.length === 0) {
          throw new Error('upload_file requires selector + filePaths[]');
        }
        await engine.uploadFile(selector, filePaths, frameId);
        return undefined;
      }
      case 'screenshot':
        return `[BLOCKED] screenshot action is disabled.`;
      case 'wait':
        return `[BLOCKED] wait is disabled.`;
      case 'scroll':
        await engine.evaluate(`window.scrollBy(0, ${(raw.direction as string) === 'up' ? -400 : 400})`);
        return undefined;
      case 'scrollIntoView':
        await engine.evaluate(
          `document.querySelector('${(raw.selector as string).replace(/'/g, "\\'")}')?.scrollIntoView({block:'center',behavior:'instant'})`,
          frameId
        );
        return undefined;
      case 'app_script': {
        const result = await this.appBridge.run((action as any).app, (action as any).script);
        return result.ok ? result.output : `[AppBridge error: ${result.error}]`;
      }
      case 'task_list_peers':
      case 'task_send':
      case 'task_read':
      case 'task_message': {
        const res = await executeInterTaskAction(this.executorCtx, action as any);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'remember_fact':
      case 'forget_fact': {
        const res = executeFactAction(this.executorCtx, action as any);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'set_identity': {
        const res = executeSetIdentity(this.executorCtx, action as any);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'generate_image': {
        const res = await executeGenerateImage(this.executorCtx, action as any);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }


  private async executeCodeAction(action: TaskAction): Promise<string | undefined> {
    const raw = action as Record<string, unknown>;

    switch (action.type) {
      case 'shell': {
        const res = await executeShell(
          raw.command as string,
          raw.cwd as string | undefined,
          raw.timeout as number | undefined
        );
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'wait':
        await this.sleep(raw.ms as number);
        return undefined;
      case 'web_scrape': {
        const data = await scrapeUrl(raw.url as string, raw.instruction as string);
        this.lastScrapeData += (this.lastScrapeData ? '\n' : '') + data;
        return data;
      }
      case 'save_to_excel': {
        if (!this.lastScrapeData) return '[Error: no data available. Use web_scrape first.]';
        try {
          const filePath = await createExcelFromTsv(
            this.lastScrapeData,
            raw.filename as string,
            raw.filter as string | undefined
          );
          return `Excel saved: ${filePath}`;
        } catch (e) {
          return `[Error creating Excel: ${e instanceof Error ? e.message : String(e)}]`;
        }
      }
      case 'launch': {
        const res = await executeShell(`powershell.exe -NoProfile -Command "Start-Process '${raw.app}'"`);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'file_read': {
        const res = await executeFileRead(
          raw.path as string,
          raw.cwd as string | undefined,
          raw.offset as number | undefined,
          raw.limit as number | undefined
        );
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'file_write': {
        const res = await executeFileWrite(raw.path as string, raw.content as string, raw.cwd as string | undefined);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'file_edit': {
        const res = await executeFileEdit(
          raw.path as string,
          raw.old_string as string,
          raw.new_string as string,
          raw.cwd as string | undefined
        );
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'file_list': {
        const res = await executeFileList(raw.pattern as string, raw.cwd as string | undefined);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'file_search': {
        const res = await executeFileSearch(
          raw.pattern as string,
          raw.path as string | undefined,
          raw.glob as string | undefined,
          raw.cwd as string | undefined
        );
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'app_script': {
        const result = await this.appBridge.run(raw.app as string, raw.script as string);
        return result.ok ? result.output : `[AppBridge error: ${result.error}]`;
      }
      case 'task_list_peers':
      case 'task_send':
      case 'task_read':
      case 'task_message': {
        const res = await executeInterTaskAction(this.executorCtx, action as any);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'remember_fact':
      case 'forget_fact': {
        const res = executeFactAction(this.executorCtx, action as any);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'set_identity': {
        const res = executeSetIdentity(this.executorCtx, action as any);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'generate_image': {
        const res = await executeGenerateImage(this.executorCtx, action as any);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'polymarket_get_account_summary':
      case 'polymarket_get_trader_leaderboard':
      case 'polymarket_search_markets':
      case 'polymarket_place_order':
      case 'polymarket_close_position': {
        const res = await executePolymarketAction(this.executorCtx, action);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      default:
        return `[Action "${action.type}" not supported in code mode]`;
    }
  }

  private async executeApiOnlyAction(action: TaskAction): Promise<string | undefined> {
    const raw = action as Record<string, unknown>;
    switch (action.type) {
      case 'task_list_peers':
      case 'task_send':
      case 'task_read':
      case 'task_message': {
        const res = await executeInterTaskAction(this.executorCtx, action as any);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'remember_fact':
      case 'forget_fact': {
        const res = executeFactAction(this.executorCtx, action as any);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'set_identity': {
        const res = executeSetIdentity(this.executorCtx, action as any);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'generate_image': {
        const res = await executeGenerateImage(this.executorCtx, action as any);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'polymarket_get_account_summary':
      case 'polymarket_get_trader_leaderboard':
      case 'polymarket_search_markets':
      case 'polymarket_place_order':
      case 'polymarket_close_position': {
        const res = await executePolymarketAction(this.executorCtx, action);
        return res.ok ? res.value : `[Error: ${res.error}]`;
      }
      case 'wait':
        await this.sleep((raw.ms as number) ?? 1000);
        return undefined;
      default:
        return `[Error: "${action.type}" is not available in API-only mode.]`;
    }
  }

  private addUsage(usage: { inputTokens: number; outputTokens: number }): void {
    if (!this.usageTotals) this.usageTotals = { inputTokens: 0, outputTokens: 0 };
    this.usageTotals.inputTokens += usage.inputTokens;
    this.usageTotals.outputTokens += usage.outputTokens;
    this.task.usage = { ...this.usageTotals };
  }

  abort(reason?: string): void {
    this.aborted = true;
    if (reason) this.task.error = reason;
    this.cleanup();
  }

  private lastScrapeData = '';

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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getTask(): Task {
    return { ...this.task };
  }

  private getProviderDisplayName(): string {
    const provider = this.opts.provider;
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

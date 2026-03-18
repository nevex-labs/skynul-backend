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

import type { ProviderId, Task, TaskAction, TaskStep } from '../../types';
import type { BrowserEngine } from '../browser/engine/browser-engine';
import { acquireBrowserEngine } from '../browser/engine/factory';
import { type VisionMessage } from '../providers/codex-vision';
import { callVision } from './vision-dispatch';
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
import { compressHistory, truncateHistory, buildActionLog, drainInbox } from './history-manager';
import { parseModelResponse } from './action-parser';
import { AppBridge } from './app-bridge';
import { createExcelFromTsv } from './excel-writer';
import { buildBrowserSystemPrompt, buildCdpSystemPrompt, buildCodeSystemPrompt } from './system-prompt';
import { scrapeUrl } from './web-scraper';

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
  private autoDelegated = false;

  private get executorCtx(): ExecutorContext {
    return {
      task: this.task,
      taskManager: this.opts.taskManager ?? null,
      appBridge: this.appBridge,
      pushUpdate: () => this.pushUpdate(),
      pushStatus: (msg) => this.pushStatus(msg),
    };
  }

  private shouldAutoDelegate(prompt: string): boolean {
    const p = prompt.toLowerCase();
    const wantsPost = /(\bpost\b|\btweet\b|\bpublish\b|poste(a|ar)|public(a|ar)|borrador|draft)/.test(p);
    const wantsX = /(\bx\b|twitter|x\.com)/.test(p);
    const wantsImage = /(\bimage\b|\bimagen\b|\bmeme\b|\bpicture\b|\bgenerate\b.*\bimage\b)/.test(p);
    const wantsCopy = /(\bcopy\b|caption|two\s*lines|2\s*lines|dos\s*lineas|hashtags|cta)/.test(p);
    return (wantsPost && wantsX && wantsImage && wantsCopy) || (wantsPost && wantsImage && wantsCopy);
  }

  private async autoDelegateForSocialPost(history: VisionMessage[]): Promise<void> {
    if (this.autoDelegated) return;
    const tm = this.opts.taskManager;
    if (!tm) return;
    if (this.task.parentTaskId) return;
    if (!this.shouldAutoDelegate(this.task.prompt)) return;

    this.autoDelegated = true;
    this.pushStatus('Setting up multi-agent plan (Copy + Design)...');

    const [copyRes, designRes] = await Promise.all([
      tm.spawnAndWait(
        'You MUST respond using the Skynul agent JSON protocol (thought + action). Return ONE JSON object only. action.type MUST be "done". action.summary must contain plain text with: 3 numbered options (TWO lines each) and then "Recommended:". Constraints: English, bullish BTC meme vibe, short and punchy.',
        [],
        this.task.id,
        { agentRole: 'Copy' }
      ),
      tm.spawnAndWait(
        'You MUST respond using the Skynul agent JSON protocol (thought + action). Return ONE JSON object only. action.type MUST be "done". action.summary must contain plain text with: (1) image-gen prompt, (2) on-image text, (3) composition notes, (4) aspect ratio for X.',
        [],
        this.task.id,
        { agentRole: 'Design' }
      ),
    ]);

    history.push({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text:
            `Sub-agent outputs (use these; do NOT redo):\n` +
            `- Copy (${copyRes.taskId}): ${copyRes.output}\n` +
            `- Design (${designRes.taskId}): ${designRes.output}\n\n` +
            `Now execute the full flow in X: open composer, generate/upload image based on Design, paste final chosen copy, and POST.`,
        },
      ],
    });
  }

  constructor(
    task: Task,
    private opts: TaskRunnerOpts,
    private callbacks: TaskRunnerCallbacks
  ) {
    this.task = { ...task };
  }

  async run(): Promise<Task> {
    if (this.task.mode === 'code') return this.runCode();
    if (this.task.capabilities.includes('polymarket.trading')) return this.runCdp();
    return this.runBrowser();
  }

  private async runBrowser(): Promise<Task> {
    this.pushStatus('Launching browser...');

    let engine: BrowserEngine;
    let release: (() => Promise<void>) | null = null;
    try {
      const acquired = await acquireBrowserEngine();
      engine = acquired.engine;
      release = acquired.release;
      this.pushStatus('Browser ready');
    } catch (e) {
      return this.finish('failed', `Browser launch failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (this.aborted) {
      if (release) await release().catch(() => {});
      return this.finish('cancelled');
    }

    this.timeoutHandle = setTimeout(() => this.abort('Task timed out'), this.task.timeoutMs);
    const systemPrompt = buildBrowserSystemPrompt(!!this.task.parentTaskId);
    const history: VisionMessage[] = [];
    const memCtx = this.opts.memoryContext ? `\n\nContext from memory:\n${this.opts.memoryContext}` : '';

    const { filePaths: attachPaths, dataUrls: attachDataUrls } = await resolveAttachments(this.task.attachments);
    const attachBlock =
      attachPaths.length > 0
        ? `\n\nReference files (use upload_file with these paths to upload them to any site):\n${attachPaths.map((p) => `- ${p}`).join('\n')}`
        : '';

    await this.autoDelegateForSocialPost(history);

    try {
      for (let step = 0; step < this.task.maxSteps && !this.aborted; step++) {
        const snap = await engine.snapshot().catch(() => ({
          url: '',
          title: '',
          snapshot: '(page not available)',
        }));

        const actionLog = this.task.steps.length > 0
          ? buildActionLog(this.task.steps, 8, { includeFailedSelectors: true, truncateResult: 200, truncateError: 100 })
          : '';

        const turnText =
          step === 0
            ? `Task: ${this.task.prompt}${attachBlock}${memCtx}\n\nCurrent page:\nURL: ${snap.url}\nTitle: ${snap.title}\n\nPage snapshot:\n${snap.snapshot}`
            : `Step ${step + 1}.\nURL: ${snap.url}\nTitle: ${snap.title}\n\nPage snapshot:\n${snap.snapshot}${actionLog}`;

        const inboxBlock = drainInbox(this.opts.taskManager ?? null, this.opts.taskId ?? this.task.id);
        const turnMessage: VisionMessage = {
          role: 'user',
          content: [
            { type: 'input_text', text: turnText + inboxBlock },
            ...(step === 0
              ? attachDataUrls.slice(0, 4).map((url) => ({
                  type: 'input_image' as const,
                  detail: 'auto' as const,
                  image_url: url,
                }))
              : []),
          ],
        };

        compressHistory(history, 6);
        history.push(turnMessage);

        const { text: rawResponse, usage } = await callVision(this.opts.provider, systemPrompt, history, this.task.id, this.opts.openaiModel);
        if (usage) this.addUsage(usage);
        const { thought, action } = parseModelResponse(rawResponse);

        history.push({ role: 'assistant', content: [{ type: 'output_text', text: rawResponse }] });

        const taskStep: TaskStep = {
          index: this.task.steps.length,
          timestamp: Date.now(),
          screenshotBase64: '',
          action,
          thought,
        };

        if (action.type === 'done') {
          this.task.summary = action.summary;
          this.task.steps.push(taskStep);
          this.pushUpdate();
          if (release) await release().catch(() => {});
          return this.finish('completed');
        }
        if (action.type === 'fail') {
          this.task.steps.push(taskStep);
          this.pushUpdate();
          if (release) await release().catch(() => {});
          return this.finish('failed', action.reason);
        }

        try {
          const result = await this.executeBrowserAction(engine, action);
          if (result) taskStep.result = result;
        } catch (e) {
          taskStep.error = e instanceof Error ? e.message : String(e);
        }

        this.task.steps.push(taskStep);
        this.pushUpdate();
        await this.sleep(500);
      }
    } catch (e) {
      if (release) await release().catch(() => {});
      if (this.aborted) return this.finish('cancelled');
      return this.finish('failed', `Browser loop error: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (release) await release().catch(() => {});
    if (this.aborted) return this.finish('cancelled');
    return this.finish('failed', `Reached max steps (${this.task.maxSteps})`);
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

  private async runCdp(): Promise<Task> {
    this.pushStatus(`Connecting to ${this.getProviderDisplayName()}...`);
    this.timeoutHandle = setTimeout(() => this.abort('Task timed out'), this.task.timeoutMs);
    this.pushStatus('Starting agent loop...');

    const systemPrompt = buildCdpSystemPrompt(this.task.capabilities, !!this.task.parentTaskId);
    const history: VisionMessage[] = [];
    const memCtxCdp = this.opts.memoryContext ?? '';
    const allAttachments = (this.task.attachments ?? []).filter((x) => typeof x === 'string');
    const imageDataUrls = allAttachments.filter((a) => a.startsWith('data:image/'));
    const filePaths = allAttachments.filter((a) => !a.startsWith('data:image/'));
    const attachmentsBlock =
      filePaths.length > 0
        ? `\n\nAttached local files (absolute paths):\n${filePaths
            .slice(0, 12)
            .map((p) => `- ${p}`)
            .join('\n')}`
        : '';

    history.push({
      role: 'user',
      content: [
        { type: 'input_text', text: `Task: ${this.task.prompt}${attachmentsBlock}${memCtxCdp}` },
        ...imageDataUrls.slice(0, 4).map((url) => ({
          type: 'input_image' as const,
          detail: 'auto' as const,
          image_url: url,
        })),
      ],
    });

    while (!this.aborted && this.task.steps.length < this.task.maxSteps) {
      try {
        const stepIndex = this.task.steps.length;
        const actionLog = stepIndex > 0
          ? buildActionLog(this.task.steps, 8, { truncateResult: 200, truncateError: 100 })
          : '';

        const turnText =
          stepIndex === 0
            ? `Task: ${this.task.prompt}\n\nYou are in API-only mode. Use the polymarket_* actions directly. Do NOT use shell, navigate, or evaluate.`
            : `Step ${stepIndex + 1}.${actionLog}`;

        const inboxBlock = drainInbox(this.opts.taskManager ?? null, this.opts.taskId ?? this.task.id);
        const turnMessage: VisionMessage = {
          role: 'user',
          content: [{ type: 'input_text', text: turnText + inboxBlock }],
        };

        compressHistory(history, 6);
        history.push(turnMessage);

        const { text: rawResponse, usage } = await callVision(this.opts.provider, systemPrompt, history, this.task.id, this.opts.openaiModel);
        if (usage) this.addUsage(usage);
        const { thought, action } = parseModelResponse(rawResponse);

        history.push({ role: 'assistant', content: [{ type: 'output_text', text: rawResponse }] });

        const step: TaskStep = {
          index: this.task.steps.length,
          timestamp: Date.now(),
          screenshotBase64: '',
          action,
          thought,
        };

        if (action.type === 'done') {
          this.task.summary = action.summary;
          this.task.steps.push(step);
          this.pushUpdate();
          return this.finish('completed');
        }
        if (action.type === 'fail') {
          this.task.steps.push(step);
          this.pushUpdate();
          return this.finish('failed', action.reason);
        }

        try {
          const result = await this.executeApiOnlyAction(action);
          if (result) step.result = result;
        } catch (e) {
          step.error = e instanceof Error ? e.message : String(e);
        }

        this.task.steps.push(step);
        this.pushUpdate();
        await this.sleep(500);
      } catch (e) {
        if (this.aborted) break;
        return this.finish('failed', `API loop error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (this.aborted) return this.finish('cancelled');
    return this.finish('failed', `Reached max steps (${this.task.maxSteps})`);
  }

  private async runCode(): Promise<Task> {
    this.pushStatus(`Connecting to ${this.getProviderDisplayName()}...`);
    if (this.aborted) return this.finish('cancelled');
    this.timeoutHandle = setTimeout(() => this.abort('Task timed out'), this.task.timeoutMs);
    this.pushStatus('Preparing agent loop...');

    const systemPrompt = buildCodeSystemPrompt(this.task.capabilities, !!this.task.parentTaskId);
    const history: VisionMessage[] = [];
    const memCtx = this.opts.memoryContext ?? '';

    history.push({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `Task: ${this.task.prompt}${memCtx}\n\n[CODE MODE] You have NO screen access. Do NOT use click, scroll, move, or other screen actions.${this.task.capabilities.includes('app.scripting') ? ' [APP SCRIPTING ACTIVE] You MUST use app_script for design tasks. Do NOT use file_write for design files. Keep scripts under 6 lines.' : ' Use file_read, file_write, file_edit, file_list, file_search, and shell.'}`,
        },
      ],
    });

    while (!this.aborted && this.task.steps.length < this.task.maxSteps) {
      try {
        const stepIndex = this.task.steps.length;
        let turnText: string;
        if (stepIndex === 0) {
          turnText = this.task.capabilities.includes('app.scripting')
            ? `Task: ${this.task.prompt}\n\n[APP SCRIPTING MODE] Use ONLY app_script actions. Keep scripts under 6 lines. Do NOT use file_write for design files.\n\nIMPORTANT: Take your time. Build the design in MANY small steps (10-20+ steps). Do NOT rush to save/done after 2-3 shapes. Each step should add ONE element: a shape, a color, a text, an alignment. Build up complexity gradually.`
            : `Task: ${this.task.prompt}\n\n[CODE MODE] No screen. Use file_read/file_write/file_edit/file_list/file_search/shell/done/fail actions.`;
        } else {
          const recentSteps = this.task.steps.slice(-8);
          const actionLog = recentSteps
            .map((s) => {
              const a = s.action;
              let desc: string = a.type;
              if (a.type === 'shell') desc = `shell "${((a as any).command as string)?.slice(0, 80) || ''}"`;
              else if (a.type === 'file_read') desc = `file_read ${(a as any).path}`;
              else if (a.type === 'file_write') desc = `file_write ${(a as any).path}`;
              else if (a.type === 'file_edit') desc = `file_edit ${(a as any).path}`;
              else if (a.type === 'file_list') desc = `file_list "${(a as any).pattern}"`;
              else if (a.type === 'file_search') desc = `file_search "${(a as any).pattern}"`;
              const resultSuffix = s.result ? ` → ${s.result.slice(0, 300)}` : '';
              const errorSuffix = s.error ? ` [ERROR: ${s.error.slice(0, 100)}]` : '';
              return `Step ${s.index + 1}: ${desc}${resultSuffix}${errorSuffix}`;
            })
            .join('\n');
          turnText = `Step ${stepIndex + 1}.\n\nRecent actions:\n${actionLog}\n\nContinue with the next step.`;
        }

        turnText += drainInbox(this.opts.taskManager ?? null, this.opts.taskId ?? this.task.id);
        const turnMessage: VisionMessage = {
          role: 'user',
          content: [{ type: 'input_text', text: turnText }],
        };

        if (history.length > 20) truncateHistory(history, 19);
        history.push(turnMessage);

        this.pushStatus('Thinking...');
        const { text: rawResponse, usage } = await callVision(this.opts.provider, systemPrompt, history, this.task.id, this.opts.openaiModel);
        if (usage) this.addUsage(usage);
        console.log(`[code-loop] raw (${rawResponse.length}c):`, rawResponse.slice(0, 400));
        const { thought, action } = parseModelResponse(rawResponse);

        history.push({ role: 'assistant', content: [{ type: 'output_text', text: rawResponse }] });

        const step: TaskStep = {
          index: this.task.steps.length,
          timestamp: Date.now(),
          screenshotBase64: '',
          action,
          thought,
        };

        if (action.type === 'done') {
          this.task.summary = action.summary;
          this.task.steps.push(step);
          this.pushUpdate();
          return this.finish('completed');
        }
        if (action.type === 'fail') {
          this.task.steps.push(step);
          this.pushUpdate();
          return this.finish('failed', action.reason);
        }

        if (['click', 'double_click', 'scroll', 'move'].includes(action.type)) {
          step.error = `Action "${action.type}" not available in code mode.`;
          this.task.steps.push(step);
          this.pushUpdate();
          await this.sleep(200);
          continue;
        }

        try {
          const result = await this.executeCodeAction(action);
          if (result) step.result = result;
        } catch (e) {
          step.error = e instanceof Error ? e.message : String(e);
        }

        this.task.steps.push(step);
        this.pushUpdate();

        if (
          action.type === 'app_script' &&
          this.task.capabilities.includes('app.scripting') &&
          this.task.steps.filter((s) => s.action.type === 'app_script').length % 3 === 0
        ) {
          try {
            const appName = (action as any).app as string;
            const previewB64 = await this.appBridge.getPreview(appName as any);
            if (previewB64) {
              history.push({
                role: 'user',
                content: [
                  { type: 'input_text', text: '[CANVAS PREVIEW] Look at the current state of your design.' },
                  { type: 'input_image', image_url: `data:image/png;base64,${previewB64}` },
                ],
              });
            }
          } catch {
            // Preview failed — continue without it
          }
        }

        await this.sleep(200);
      } catch (e) {
        if (this.aborted) break;
        return this.finish('failed', `Code loop error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (this.aborted) return this.finish('cancelled');
    return this.finish('failed', `Reached max steps (${this.task.maxSteps})`);
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

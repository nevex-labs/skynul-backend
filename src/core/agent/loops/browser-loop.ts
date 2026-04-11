/**
 * Browser mode — setup, turn building, and action execution.
 */

import type { Task, TaskAction, VisionMessage } from '../../../types';
import type { BrowserEngine } from '../../browser/engine/browser-engine';
import { acquireBrowserEngine } from '../../browser/engine/factory';
import { buildBrowserSystemPrompt } from '../../prompts/browser';
import type { ExecutorContext } from '../action-executors';
import {
  executeFactAction,
  executeImageAction,
  executeInterTaskAction,
  executeMemoryAction,
  resolveAttachments,
} from '../action-executors';
import { buildActionLog } from '../history-manager';
import type { TaskManager } from '../task-manager';
import type { LoopCallbacks } from './agent-loop';
import { FACT_ACTIONS, INTER_TASK_ACTIONS, MEMORY_ACTIONS, unwrap } from './shared';

export type BrowserLoopSetup = {
  deps: {
    task: Task;
    memoryContext?: string;
    taskManager: TaskManager | null;
    parentTaskId?: string;
    maxSteps: number;
    paperMode?: boolean;
  };
  onStatus: (msg: string) => void;
  onUpdate: (task: Task) => void;
  isAborted: () => boolean;
};

export type BrowserLoopResult = {
  engine: BrowserEngine;
  release: () => Promise<void>;
  systemPrompt: string;
  systemPromptCompact: string;
  history: VisionMessage[];
  callbacks: LoopCallbacks;
};

export async function setupBrowserLoop(setup: BrowserLoopSetup): Promise<BrowserLoopResult> {
  const { task, memoryContext, taskManager, parentTaskId } = setup.deps;
  setup.onStatus('Launching browser...');

  let engine: BrowserEngine;
  let release: (() => Promise<void>) | null = null;
  try {
    const acquired = await acquireBrowserEngine();
    engine = acquired.engine;
    release = acquired.release;
    setup.onStatus('Browser ready');
  } catch (e) {
    task.status = 'failed';
    task.error = `Browser launch failed: ${e instanceof Error ? e.message : String(e)}`;
    task.updatedAt = Date.now();
    setup.onUpdate(task);
    throw e;
  }

  if (setup.isAborted()) {
    if (release) await release().catch(() => {});
    const err = new Error('cancelled') as Error & { __cancelled?: true };
    err.__cancelled = true;
    throw err;
  }

  const { paperMode } = setup.deps;
  const systemPrompt = buildBrowserSystemPrompt(!!parentTaskId, false, !!paperMode);
  const systemPromptCompact = buildBrowserSystemPrompt(!!parentTaskId, true, !!paperMode);
  const history: VisionMessage[] = [];
  const memCtx = memoryContext ? `\n\nContext from memory:\n${memoryContext}` : '';

  const { filePaths: attachPaths, dataUrls: attachDataUrls } = await resolveAttachments(task.attachments ?? []);
  const attachBlock =
    attachPaths.length > 0
      ? `\n\nReference files (use upload_file with these paths to upload them to any site):\n${attachPaths.map((p) => `- ${p}`).join('\n')}`
      : '';

  await autoDelegateForSocialPost(task, taskManager, history, setup.onStatus);

  const callbacks: LoopCallbacks = {
    taskManager,
    async buildTurnMessage(stepIndex, budget) {
      let snap = { url: '', title: '', snapshot: '(page not available)' };
      try {
        snap = await engine.snapshot();
      } catch (_) {
        /* ignore snapshot errors */
      }
      if (stepIndex === 0) {
        return {
          text: `Task: ${task.prompt}${attachBlock}${memCtx}\n\nCurrent page:\nURL: ${snap.url}\nTitle: ${snap.title}\n\nPage snapshot:\n${snap.snapshot}`,
          images: attachDataUrls.slice(0, 4),
        };
      }
      // Level 1: reduce action log size when context pressure is high
      const compact = budget?.applyLevel1;
      const actionLog = buildActionLog(task.steps, compact ? 4 : 8, {
        includeFailedSelectors: true,
        truncateResult: compact ? 100 : 200,
        truncateError: 100,
      });
      return {
        text: `Step ${stepIndex + 1}.\nURL: ${snap.url}\nTitle: ${snap.title}\n\nPage snapshot:\n${snap.snapshot}${actionLog}`,
      };
    },
    recordStep() {
      task.updatedAt = Date.now();
      setup.onUpdate(task);
    },
    pushStatus: setup.onStatus,
    isAborted: setup.isAborted,
  };

  if (!release) throw new Error('Browser engine acquired without a release handle');
  return { engine, release, systemPrompt, systemPromptCompact, history, callbacks };
}

async function autoDelegateForSocialPost(
  task: Task,
  taskManager: TaskManager | null,
  history: VisionMessage[],
  onStatus: (msg: string) => void
): Promise<void> {
  if (!taskManager || task.parentTaskId) return;
  const p = task.prompt.toLowerCase();
  const wantsPost = /(\bpost\b|\btweet\b|\bpublish\b|poste(a|ar)|public(a|ar)|borrador|draft)/.test(p);
  const wantsX = /(\bx\b|twitter|x\.com)/.test(p);
  const wantsImage = /(\bimage\b|\bimagen\b|\bmeme\b|\bpicture\b|\bgenerate\b.*\bimage\b)/.test(p);
  const wantsCopy = /(\bcopy\b|caption|two\s*lines|2\s*lines|dos\s*lineas|hashtags|cta)/.test(p);
  if (!((wantsPost && wantsX && wantsImage && wantsCopy) || (wantsPost && wantsImage && wantsCopy))) return;

  onStatus('Setting up multi-agent plan (Copy + Design)...');
  const [copyRes, designRes] = await Promise.all([
    taskManager.spawnAndWait(
      'You MUST respond using the Skynul agent JSON protocol (thought + action). Return ONE JSON object only. action.type MUST be "done". action.summary must contain plain text with: 3 numbered options (TWO lines each) and then "Recommended:". Constraints: English, bullish BTC meme vibe, short and punchy.',
      [],
      task.id,
      { agentRole: 'Copy' }
    ),
    taskManager.spawnAndWait(
      'You MUST respond using the Skynul agent JSON protocol (thought + action). Return ONE JSON object only. action.type MUST be "done". action.summary must contain plain text with: (1) image-gen prompt, (2) on-image text, (3) composition notes, (4) aspect ratio for X.',
      [],
      task.id,
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

function resolveKeyCombo(raw: Record<string, unknown>): string {
  return (raw.key as string) || (raw.combo as string);
}

async function handleBrowserUploadFile(
  engine: BrowserEngine,
  raw: Record<string, unknown>,
  frameId: string | undefined
): Promise<void> {
  const selector = raw.selector as string;
  const filePaths = raw.filePaths as string[];
  if (!selector || !Array.isArray(filePaths) || filePaths.length === 0)
    throw new Error('upload_file requires selector + filePaths[]');
  await engine.uploadFile(selector, filePaths, frameId);
}

async function handleBrowserIdentity(action: TaskAction, ctx: ExecutorContext): Promise<string> {
  const identity = action as Extract<TaskAction, { type: 'set_identity' }>;
  ctx.task.agentName = identity.name;
  if (identity.role) ctx.task.agentRole = identity.role;
  ctx.task.updatedAt = Date.now();
  ctx.pushUpdate();
  return `Identity set: ${identity.name}${identity.role ? ` (${identity.role})` : ''}`;
}

async function handleBrowserSystemAction(
  engine: BrowserEngine,
  action: TaskAction,
  ctx: ExecutorContext,
  raw: Record<string, unknown>,
  frameId: string | undefined,
  type: string
): Promise<string | undefined> {
  if (type === 'screenshot') return '[BLOCKED] screenshot action is disabled.';
  if (type === 'wait') return '[BLOCKED] wait is disabled.';
  if (type === 'scroll') {
    await engine.evaluate(`window.scrollBy(0, ${(raw.direction as string) === 'up' ? -400 : 400})`);
    return undefined;
  }
  if (type === 'scrollIntoView') {
    await engine.evaluate(
      `document.querySelector('${(raw.selector as string).replace(/'/g, "\\'")}')?.scrollIntoView({block:'center',behavior:'instant'})`,
      frameId
    );
    return undefined;
  }
  if (type === 'app_script') {
    const result = await ctx.appBridge.run((action as any).app, (action as any).script);
    return result.ok ? result.output : `[AppBridge error: ${result.error}]`;
  }
  return undefined;
}

async function handleBrowserAgentAction(action: TaskAction, ctx: ExecutorContext, type: string): Promise<string> {
  if (INTER_TASK_ACTIONS.has(type))
    return unwrap(await executeInterTaskAction(ctx, action as Parameters<typeof executeInterTaskAction>[1]));
  if (FACT_ACTIONS.has(type))
    return unwrap(await executeFactAction(ctx, action as Parameters<typeof executeFactAction>[1]));
  if (MEMORY_ACTIONS.has(type))
    return unwrap(await executeMemoryAction(ctx, action as Parameters<typeof executeMemoryAction>[1]));
  if (type === 'set_identity') return handleBrowserIdentity(action, ctx);
  if (type === 'generate_image')
    return unwrap(await executeImageAction(ctx, action as Parameters<typeof executeImageAction>[1]));
  throw new Error(`Unknown action type: ${action.type}`);
}

/** Execute a browser-mode action on the engine. */
export async function executeBrowserAction(
  engine: BrowserEngine,
  action: TaskAction,
  ctx: ExecutorContext
): Promise<string | undefined> {
  const raw = action as Record<string, unknown>;
  const frameId = raw.frameId as string | undefined;

  const handler = ACTION_HANDLERS[raw.type as string as keyof typeof ACTION_HANDLERS];
  if (handler) return handler(engine, raw, frameId, action, ctx);

  const sys = await handleBrowserSystemAction(engine, action, ctx, raw, frameId, raw.type as string);
  if (sys !== undefined) return sys;
  return handleBrowserAgentAction(action, ctx, raw.type as string);
}

type BrowserActionHandler = (
  engine: BrowserEngine,
  raw: Record<string, unknown>,
  frameId: string | undefined,
  action: TaskAction,
  ctx: ExecutorContext
) => Promise<string | undefined>;

const ACTION_HANDLERS: Record<string, BrowserActionHandler> = {
  navigate: async (engine, raw) => {
    // caller handles navigate result
    await engine.navigate(String(raw.url ?? ''));
    return undefined;
  },
  click: async (engine, raw, frameId) => {
    await engine.click(raw.selector as string, frameId);
    return undefined;
  },
  type: async (engine, raw, frameId) => {
    await engine.type(raw.selector as string, raw.text as string, frameId);
    return undefined;
  },
  pressKey: async (engine, raw) => {
    await engine.pressKey(raw.key as string);
    return undefined;
  },
  key: async (engine, raw) => {
    await engine.pressKey(resolveKeyCombo(raw));
    return undefined;
  },
  evaluate: async (engine, raw, frameId) => {
    const result = await engine.evaluate(raw.script as string, frameId);
    return result || undefined;
  },
  upload_file: async (engine, raw, frameId) => {
    await handleBrowserUploadFile(engine, raw, frameId);
    return undefined;
  },
  shell: async (_engine, raw) => {
    const { executeShell } = await import('../action-executors');
    const res = await executeShell(
      raw.command as string,
      raw.cwd as string | undefined,
      raw.timeout as number | undefined
    );
    return res.ok ? res.value : `[Error: ${res.error}]`;
  },
  keyboard_type: async (engine, raw) => {
    const text = String(raw.text ?? '');
    if (!text) return '[keyboard_type] No text provided';
    await engine.keyboardType(text);
    return undefined;
  },
  scrollIntoView: async (engine, raw, frameId) => {
    await engine.evaluate(`document.querySelector('${raw.selector}')?.scrollIntoView({behavior:'smooth'})`, frameId);
    return undefined;
  },
};

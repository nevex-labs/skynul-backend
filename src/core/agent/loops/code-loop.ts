/**
 * Code mode — file/shell execution, no browser.
 */

import { createExcelFromTsv } from '../../../capabilities/files/excel-writer';
import { scrapeUrl } from '../../../capabilities/scraping/web-scraper';
import type { Task, TaskAction, TaskStep, VisionMessage } from '../../../types';
import { buildCodeSystemPrompt } from '../../prompts/code';
import type { ExecutorContext } from '../action-executors';
import {
  executeFactAction,
  executeFileEdit,
  executeFileList,
  executeFileRead,
  executeFileWrite,
  executeImageAction,
  executeInterTaskAction,
  executeMemoryAction,
  executeShell,
} from '../action-executors';
import type { TaskManager } from '../task-manager';
import type { LoopCallbacks } from './agent-loop';

function describeCodeStep(s: TaskStep, resultLimit: number): string {
  const a = s.action as Record<string, unknown>;
  const ACTION_DESCRIPTIONS: Record<string, () => string> = {
    shell: () => `shell "${((a.command as string) ?? '').slice(0, 80)}"`,
    file_read: () => `file_read ${a.path}`,
    file_write: () => `file_write ${a.path}`,
    file_edit: () => `file_edit ${a.path}`,
    file_list: () => `file_list "${a.pattern}"`,
    file_search: () => `file_search "${a.pattern}"`,
  };
  const desc = ACTION_DESCRIPTIONS[a.type as string]?.() ?? (a.type as string);
  const resultSuffix = s.result ? ` → ${s.result.slice(0, resultLimit)}` : '';
  const errorSuffix = s.error ? ` [ERROR: ${s.error.slice(0, 100)}]` : '';
  return `Step ${s.index + 1}: ${desc}${resultSuffix}${errorSuffix}`;
}

export type CodeLoopSetup = {
  deps: {
    task: Task;
    memoryContext?: string;
    taskManager: TaskManager | null;
    parentTaskId?: string;
    maxSteps: number;
  };
  onStatus: (msg: string) => void;
  onUpdate: (task: Task) => void;
  isAborted: () => boolean;
};

export function setupCodeLoop(setup: CodeLoopSetup): {
  systemPrompt: string;
  systemPromptCompact: string;
  history: VisionMessage[];
  callbacks: LoopCallbacks;
} {
  const { task, memoryContext, taskManager, parentTaskId } = setup.deps;
  const systemPrompt = buildCodeSystemPrompt(task.capabilities, !!parentTaskId, false);
  const systemPromptCompact = buildCodeSystemPrompt(task.capabilities, !!parentTaskId, true);
  const history: VisionMessage[] = [];
  const memCtx = memoryContext ?? '';
  const isAppScripting = task.capabilities.includes('app.scripting');

  const initialText = isAppScripting
    ? `Task: ${task.prompt}${memCtx}\n\n[APP SCRIPTING MODE] Use ONLY app_script actions. Keep scripts under 6 lines. Do NOT use file_write for design files.\n\nIMPORTANT: Take your time. Build the design in MANY small steps (10-20+ steps). Do NOT rush to save/done after 2-3 shapes. Each step should add ONE element: a shape, a color, a text, an alignment. Build up complexity gradually.`
    : `Task: ${task.prompt}${memCtx}\n\n[CODE MODE] You have NO screen access. Do NOT use click, scroll, move, or other screen actions.${isAppScripting ? ' [APP SCRIPTING ACTIVE] You MUST use app_script for design tasks. Do NOT use file_write for design files. Keep scripts under 6 lines.' : ' Use file_read, file_write, file_edit, file_list, file_search, and shell.'}`;

  history.push({
    role: 'user',
    content: [{ type: 'input_text', text: initialText }],
  });

  const callbacks: LoopCallbacks = {
    taskManager,
    buildTurnMessage(stepIndex, budget) {
      if (stepIndex === 0) return { text: initialText };
      const compact = budget?.applyLevel1;
      const resultLimit = compact ? 150 : 300;
      const actionLog = task.steps
        .slice(compact ? -4 : -8)
        .map((s) => describeCodeStep(s, resultLimit))
        .join('\n');
      return { text: `Step ${stepIndex + 1}.\n\nRecent actions:\n${actionLog}\n\nContinue with the next step.` };
    },
    executeAction(_action) {
      throw new Error('executeAction must be provided by TaskRunner');
    },
    recordStep() {
      task.updatedAt = Date.now();
      setup.onUpdate(task);
    },
    pushStatus: setup.onStatus,
    isAborted: setup.isAborted,
  };

  return { systemPrompt, systemPromptCompact, history, callbacks };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function unwrap(res: { ok: boolean; value?: string; error?: string }): string {
  return res.ok ? (res.value ?? '') : `[Error: ${res.error}]`;
}

const CODE_INTER_TASK_ACTIONS = new Set(['task_list_peers', 'task_send', 'task_read', 'task_message']);
const CODE_FACT_ACTIONS = new Set(['remember_fact', 'forget_fact']);
const CODE_MEMORY_ACTIONS = new Set(['memory_save', 'memory_search', 'memory_context']);
const CODE_TRADING_DISABLED = new Set([
  'polymarket_get_account_summary',
  'polymarket_get_trader_leaderboard',
  'polymarket_search_markets',
  'polymarket_place_order',
  'polymarket_close_position',
]);

async function execFileAction(action: TaskAction, raw: Record<string, unknown>): Promise<string | undefined> {
  if (action.type === 'file_read')
    return unwrap(
      await executeFileRead(
        raw.path as string,
        raw.cwd as string | undefined,
        raw.offset as number | undefined,
        raw.limit as number | undefined
      )
    );
  if (action.type === 'file_write')
    return unwrap(await executeFileWrite(raw.path as string, raw.content as string, raw.cwd as string | undefined));
  if (action.type === 'file_edit')
    return unwrap(
      await executeFileEdit(
        raw.path as string,
        raw.old_string as string,
        raw.new_string as string,
        raw.cwd as string | undefined
      )
    );
  if (action.type === 'file_list')
    return unwrap(await executeFileList(raw.pattern as string, raw.cwd as string | undefined));
  return undefined;
}

async function execExcelAction(raw: Record<string, unknown>, state: { lastScrapeData: string }): Promise<string> {
  if (!state.lastScrapeData) return '[Error: no data available. Use web_scrape first.]';
  try {
    const filePath = await createExcelFromTsv(
      state.lastScrapeData,
      raw.filename as string,
      raw.filter as string | undefined
    );
    return `Excel saved: ${filePath}`;
  } catch (e) {
    return `[Error creating Excel: ${e instanceof Error ? e.message : String(e)}]`;
  }
}

const CODE_FILE_ACTIONS = new Set(['file_read', 'file_write', 'file_edit', 'file_list']);

async function handleCodeSetIdentity(action: TaskAction, ctx: ExecutorContext): Promise<string> {
  const a = action as any;
  ctx.task.agentName = a.name;
  if (a.role) ctx.task.agentRole = a.role;
  ctx.task.updatedAt = Date.now();
  ctx.pushUpdate();
  return `Identity set: ${a.name}${a.role ? ` (${a.role})` : ''}`;
}

function buildFileSearchCmd(a: any): string {
  const glob = a.glob ? `--glob '${a.glob}'` : '';
  const searchPath = a.path ?? '.';
  return `rg -l ${glob} '${a.pattern}' ${searchPath}`;
}

async function handleCodeComputeAction(
  action: TaskAction,
  _ctx: ExecutorContext,
  state: { lastScrapeData: string },
  raw: Record<string, unknown>
): Promise<string | undefined> {
  if (action.type === 'shell')
    return unwrap(
      await executeShell(raw.command as string, raw.cwd as string | undefined, raw.timeout as number | undefined)
    );
  if (action.type === 'wait') {
    await sleep(raw.ms as number);
    return undefined;
  }
  if (action.type === 'web_scrape') {
    const data = await scrapeUrl(raw.url as string, raw.instruction as string);
    state.lastScrapeData = [state.lastScrapeData, data].filter(Boolean).join('\n');
    return data;
  }
  if (action.type === 'save_to_excel') return execExcelAction(raw, state);
  return undefined;
}

async function handleCodeSystemAction(
  action: TaskAction,
  ctx: ExecutorContext,
  raw: Record<string, unknown>
): Promise<string | undefined> {
  if (action.type === 'launch')
    return unwrap(await executeShell(`powershell.exe -NoProfile -Command "Start-Process '${raw.app}'"`));
  if (action.type === 'file_search')
    return unwrap(await executeShell(buildFileSearchCmd(action as any), (action as any).cwd, 30_000));
  if (action.type === 'app_script') {
    const result = await ctx.appBridge.run(raw.app as string, raw.script as string);
    return result.ok ? result.output : `[AppBridge error: ${result.error}]`;
  }
  if (action.type === 'set_identity') return handleCodeSetIdentity(action, ctx);
  if (action.type === 'generate_image') return unwrap(await executeImageAction(ctx, action));
  return undefined;
}

async function handleCodeMiscAction(
  action: TaskAction,
  ctx: ExecutorContext,
  state: { lastScrapeData: string },
  raw: Record<string, unknown>
): Promise<string | undefined> {
  const compute = await handleCodeComputeAction(action, ctx, state, raw);
  if (compute !== undefined) return compute;
  return handleCodeSystemAction(action, ctx, raw);
}

/** Execute a code-mode action. */
export async function executeCodeAction(
  action: TaskAction,
  ctx: ExecutorContext,
  state: { lastScrapeData: string }
): Promise<string | undefined> {
  const raw = action as Record<string, unknown>;
  if (CODE_TRADING_DISABLED.has(action.type)) return '[Trading disabled]';
  if (CODE_INTER_TASK_ACTIONS.has(action.type))
    return unwrap(await executeInterTaskAction(ctx, action as Parameters<typeof executeInterTaskAction>[1]));
  if (CODE_FACT_ACTIONS.has(action.type))
    return unwrap(await executeFactAction(ctx, action as Parameters<typeof executeFactAction>[1]));
  if (CODE_MEMORY_ACTIONS.has(action.type))
    return unwrap(await executeMemoryAction(ctx, action as Parameters<typeof executeMemoryAction>[1]));
  if (CODE_FILE_ACTIONS.has(action.type)) return execFileAction(action, raw);
  const misc = await handleCodeMiscAction(action, ctx, state, raw);
  if (misc !== undefined) return misc;
  return `[Action "${action.type}" not supported in code mode]`;
}

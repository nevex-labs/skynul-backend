/**
 * Code mode — file/shell execution, no browser.
 */

import type { Task, TaskAction } from '../../../types';
import type { VisionMessage } from '../../../types';
import type { ExecutorContext } from '../action-executors';
import {
  executeFactAction,
  executeFileEdit,
  executeFileList,
  executeFileRead,
  executeFileSearch,
  executeFileWrite,
  executeGenerateImage,
  executeInterTaskAction,
  executeMemoryAction,
  executePolymarketAction,
  executeSetIdentity,
  executeShell,
} from '../action-executors';
import { AppBridge } from '../app-bridge';
import { createExcelFromTsv } from '../excel-writer';
import { buildCodeSystemPrompt } from '../system-prompt';
import type { TaskManager } from '../task-manager';
import { scrapeUrl } from '../web-scraper';
import type { LoopCallbacks } from './agent-loop';

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

  const blockedInCodeMode = new Set(['click', 'double_click', 'scroll', 'move']);

  const callbacks: LoopCallbacks = {
    taskManager,
    buildTurnMessage(stepIndex, budget) {
      if (stepIndex === 0) {
        return { text: initialText };
      }
      // Level 1: reduce action log size when context pressure is high
      const compact = budget?.applyLevel1;
      const recentSteps = task.steps.slice(compact ? -4 : -8);
      const resultLimit = compact ? 150 : 300;
      const actionLog = recentSteps
        .map((s) => {
          const a = s.action as Record<string, unknown>;
          let desc: string = a.type as string;
          if (a.type === 'shell') desc = `shell "${((a.command as string) ?? '').slice(0, 80)}"`;
          else if (a.type === 'file_read') desc = `file_read ${a.path}`;
          else if (a.type === 'file_write') desc = `file_write ${a.path}`;
          else if (a.type === 'file_edit') desc = `file_edit ${a.path}`;
          else if (a.type === 'file_list') desc = `file_list "${a.pattern}"`;
          else if (a.type === 'file_search') desc = `file_search "${a.pattern}"`;
          const resultSuffix = s.result ? ` → ${s.result.slice(0, resultLimit)}` : '';
          const errorSuffix = s.error ? ` [ERROR: ${s.error.slice(0, 100)}]` : '';
          return `Step ${s.index + 1}: ${desc}${resultSuffix}${errorSuffix}`;
        })
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

/** Execute a code-mode action. */
export async function executeCodeAction(
  action: TaskAction,
  ctx: ExecutorContext,
  state: { lastScrapeData: string }
): Promise<string | undefined> {
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
      await sleep(raw.ms as number);
      return undefined;
    case 'web_scrape': {
      const data = await scrapeUrl(raw.url as string, raw.instruction as string);
      state.lastScrapeData += (state.lastScrapeData ? '\n' : '') + data;
      return data;
    }
    case 'save_to_excel': {
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
      const result = await ctx.appBridge.run(raw.app as string, raw.script as string);
      return result.ok ? result.output : `[AppBridge error: ${result.error}]`;
    }
    case 'task_list_peers':
    case 'task_send':
    case 'task_read':
    case 'task_message': {
      const res = await executeInterTaskAction(ctx, action as any);
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }
    case 'remember_fact':
    case 'forget_fact': {
      const res = await executeFactAction(ctx, action as any);
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }
    case 'memory_save':
    case 'memory_search':
    case 'memory_context': {
      const res = await executeMemoryAction(ctx, action as any);
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }
    case 'set_identity': {
      const res = executeSetIdentity(ctx, action as any);
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }
    case 'generate_image': {
      const res = await executeGenerateImage(ctx, action as any);
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }
    case 'polymarket_get_account_summary':
    case 'polymarket_get_trader_leaderboard':
    case 'polymarket_search_markets':
    case 'polymarket_place_order':
    case 'polymarket_close_position': {
      const res = await executePolymarketAction(ctx, action);
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }
    default:
      return `[Action "${action.type}" not supported in code mode]`;
  }
}

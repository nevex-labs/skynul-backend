/**
 * CDP / Polymarket mode — API-only, no browser.
 */

import type { Task, TaskAction } from '../../../types';
import type { VisionMessage } from '../../../types';
import type { ExecutorContext } from '../action-executors';
import {
  executeCexAction,
  executeChainAction,
  executeFactAction,
  executeGenerateImage,
  executeInterTaskAction,
  executeMemoryAction,
  executePolymarketAction,
  executeSetIdentity,
} from '../action-executors';
import { buildActionLog } from '../history-manager';
import { buildCdpSystemPrompt } from '../system-prompt';
import type { TaskManager } from '../task-manager';
import type { LoopCallbacks } from './agent-loop';

export type CdpLoopSetup = {
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

export function setupCdpLoop(setup: CdpLoopSetup): {
  systemPrompt: string;
  systemPromptCompact: string;
  history: VisionMessage[];
  callbacks: LoopCallbacks;
} {
  const { task, memoryContext, taskManager, parentTaskId } = setup.deps;
  const paperMode = setup.deps.paperMode ?? false;
  console.log(`[cdp-loop] paperMode=${paperMode}, capabilities=${task.capabilities.join(',')}`);
  const systemPrompt = buildCdpSystemPrompt(task.capabilities, !!parentTaskId, false, paperMode);
  const systemPromptCompact = buildCdpSystemPrompt(task.capabilities, !!parentTaskId, true, paperMode);
  console.log(`[cdp-loop] systemPrompt includes PAPER: ${systemPrompt.includes('TRADING MODE: PAPER')}`);
  console.log(
    `[cdp-loop] systemPrompt includes POLYMARKET TRADING ACTIONS: ${systemPrompt.includes('POLYMARKET TRADING ACTIONS')}`
  );
  console.log(
    `[cdp-loop] systemPrompt first 500 chars of polymarket block:`,
    systemPrompt.slice(systemPrompt.indexOf('POLYMARKET'), systemPrompt.indexOf('POLYMARKET') + 500)
  );
  const history: VisionMessage[] = [];
  const memCtxCdp = memoryContext ?? '';

  const allAttachments = (task.attachments ?? []).filter((x) => typeof x === 'string');
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
      {
        type: 'input_text',
        text: `Task: ${task.prompt}${attachmentsBlock}${memCtxCdp}\n\nACT NOW. Start with an API call (e.g. check balance). Do NOT respond with questions or "done".`,
      },
      ...imageDataUrls.slice(0, 4).map((url) => ({
        type: 'input_image' as const,
        detail: 'auto' as const,
        image_url: url,
      })),
    ],
  });

  const callbacks: LoopCallbacks = {
    taskManager,
    buildTurnMessage(stepIndex, budget) {
      if (stepIndex === 0) {
        const activeModes: string[] = [];
        if (task.capabilities.includes('polymarket.trading')) activeModes.push('polymarket_* actions');
        if (task.capabilities.includes('onchain.trading')) activeModes.push('chain_* actions');
        if (task.capabilities.includes('cex.trading')) activeModes.push('cex_* actions');
        const modeStr = activeModes.length > 0 ? activeModes.join(', ') : 'API actions';
        return {
          text: `Task: ${task.prompt}\n\nYou are in API-only mode. Use ${modeStr} directly. Do NOT use shell, navigate, or evaluate.\n\nCRITICAL: You are an AUTONOMOUS agent. Do NOT ask the user questions. Do NOT call "done" to ask for clarification. If the user gave you enough context to act, START IMMEDIATELY with the first action (e.g. check balance). Infer reasonable defaults for anything not specified. Your first action should ALWAYS be an API call, never "done" or "fail".`,
        };
      }
      // Level 1: reduce action log when context pressure is high
      const compact = budget?.applyLevel1;
      const actionLog = buildActionLog(task.steps, compact ? 4 : 8, {
        truncateResult: compact ? 100 : 200,
        truncateError: 100,
      });
      return { text: `Step ${stepIndex + 1}.${actionLog}` };
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

/** Execute an API-only action (Polymarket, inter-task, etc). */
export async function executeApiOnlyAction(action: TaskAction, ctx: ExecutorContext): Promise<string | undefined> {
  const raw = action as Record<string, unknown>;
  switch (action.type) {
    case 'task_list_peers':
    case 'task_send':
    case 'task_read':
    case 'task_message': {
      const res = await executeInterTaskAction(ctx, action as any);
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }
    case 'remember_fact':
    case 'forget_fact': {
      const res = executeFactAction(ctx, action as any);
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }
    case 'memory_save':
    case 'memory_search':
    case 'memory_context': {
      const res = executeMemoryAction(ctx, action as any);
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
    case 'chain_get_balance':
    case 'chain_get_token_balance':
    case 'chain_send_token':
    case 'chain_swap':
    case 'chain_get_tx_status': {
      const res = await executeChainAction(ctx, action);
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }
    case 'cex_get_balance':
    case 'cex_place_order':
    case 'cex_cancel_order':
    case 'cex_get_positions':
    case 'cex_withdraw': {
      const res = await executeCexAction(ctx, action);
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }
    case 'wait':
      await sleep((raw.ms as number) ?? 1000);
      return undefined;
    default:
      return `[Error: "${action.type}" is not available in API-only mode.]`;
  }
}

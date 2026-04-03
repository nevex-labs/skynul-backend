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
import { buildActionLog, drainInbox } from '../history-manager';
import { startPositionMonitor } from '../position-monitor';
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
        text: `Task: ${task.prompt}${attachmentsBlock}${memCtxCdp}`,
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
          text: `Task: ${task.prompt}\n\nYou are in API-only mode with ${modeStr} available. Do NOT use shell, navigate, or evaluate. Do NOT ask the user questions or call "done" to clarify.\n\nFollow PHASE 0 from your system prompt FIRST: analyze the user's goal, timeframe, and strategy in your thought BEFORE taking any action. Then proceed to PHASE 1.`,
        };
      }
      // Level 1: reduce action log when context pressure is high
      const compact = budget?.applyLevel1;
      const actionLog = buildActionLog(task.steps, compact ? 4 : 8, {
        truncateResult: compact ? 100 : 200,
        truncateError: 100,
      });
      const inbox = drainInbox(taskManager, task.id);

      // Nudge: if agent has done 5+ steps without placing an order, push to execute
      let nudge = '';
      if (stepIndex >= 5) {
        const types = task.steps.map((s) => s.action?.type).filter(Boolean);
        const hasOrder = types.some((t) =>
          t === 'polymarket_place_order' || t === 'cex_place_order' || t === 'chain_swap'
        );
        if (!hasOrder) {
          nudge = `\n\n⚠️ You have completed ${stepIndex} steps without placing a trade. STOP searching. You have enough data. Pick the best opportunity from what you already found and EXECUTE the trade NOW.`;
        }
      }

      return { text: `Step ${stepIndex + 1}.${actionLog}${inbox}${nudge}` };
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
      return res.ok ? res.value : `[Error: $res.error]`;
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
    case 'chain_get_tx_status':
    case 'chain_deploy_token': {
      const res = await executeChainAction(ctx, action);
      return res.ok ? res.value : `[Error: ${res.error}]`;
    }
    case 'cex_get_balance':
    case 'cex_get_ticker':
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
    case 'monitor_position': {
      const a = action as Extract<TaskAction, { type: 'monitor_position' }>;
      if (!ctx.taskManager) return '[Error: task manager not available for monitoring]';
      ctx.task.monitor = {
        venue: a.venue,
        tokenId: a.tokenId,
        entryPrice: a.entryPrice,
        size: a.size,
        takeProfitPrice: a.takeProfitPrice,
        stopLossPrice: a.stopLossPrice,
        intervalMs: a.intervalMs ?? 300_000,
        maxDurationMs: a.maxDurationMs ?? 7 * 24 * 60 * 60 * 1000,
        side: a.side,
        startedAt: Date.now(),
      };
      ctx.task.status = 'monitoring';
      ctx.task.updatedAt = Date.now();
      return startPositionMonitor(ctx.task, ctx.taskManager, !!ctx.paperMode);
    }
    default:
      return `[Error: "${action.type}" is not available in API-only mode.]`;
  }
}

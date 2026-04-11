/**
 * CDP / Polymarket mode — API-only, no browser.
 */

import type { Task, TaskAction, VisionMessage } from '../../../types';
import { buildCdpSystemPrompt } from '../../prompts/cdp';
import type { ExecutorContext } from '../action-executors';
import {
  executeFactAction,
  executeImageAction,
  executeInterTaskAction,
  executeMemoryAction,
} from '../action-executors';
import { buildActionLog, drainInbox } from '../history-manager';
import type { TaskManager } from '../task-manager';
import type { LoopCallbacks } from './agent-loop';
import { FACT_ACTIONS, INTER_TASK_ACTIONS, MEMORY_ACTIONS, sleep, TRADING_DISABLED_ACTIONS, unwrap } from './shared';

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
  const { task, memoryContext, taskManager, parentTaskId, paperMode } = setup.deps;
  const systemPrompt = buildCdpSystemPrompt(task.capabilities, !!parentTaskId, false, !!paperMode);
  const systemPromptCompact = buildCdpSystemPrompt(task.capabilities, !!parentTaskId, true, !!paperMode);
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
      { type: 'input_text', text: `Task: ${task.prompt}${attachmentsBlock}${memCtxCdp}` },
      ...imageDataUrls.slice(0, 4).map((url) => ({
        type: 'input_image' as const,
        detail: 'auto' as const,
        image_url: url,
      })),
    ],
  });

  function buildCdpFirstTurnText(): string {
    const CAPABILITY_MODES: Array<[string, string]> = [
      ['polymarket.trading', 'polymarket_* actions'],
      ['onchain.trading', 'chain_* actions'],
      ['cex.trading', 'cex_* actions'],
    ];
    const caps = task.capabilities as string[];
    const activeModes = CAPABILITY_MODES.filter(([cap]) => caps.includes(cap)).map(([, label]) => label);
    const modeStr = activeModes.length > 0 ? activeModes.join(', ') : 'API actions';
    return `Task: ${task.prompt}\n\nYou are in API-only mode with ${modeStr} available. Do NOT use shell, navigate, or evaluate.\n\nIMPORTANT: Before taking ANY action, you MUST first reason about the task. Analyze the user's goal, evaluate if the target is realistic, and outline your strategy (entry logic, risk management, exit plan). Only AFTER reasoning should you start executing actions.`;
  }

  const callbacks: LoopCallbacks = {
    taskManager,
    buildTurnMessage(stepIndex, budget) {
      if (stepIndex === 0) return { text: buildCdpFirstTurnText() };
      const compact = budget?.applyLevel1;
      const actionLog = buildActionLog(task.steps, compact ? 4 : 8, {
        truncateResult: compact ? 100 : 200,
        truncateError: 100,
      });
      return { text: `Step ${stepIndex + 1}.${actionLog}${drainInbox(taskManager, task.id)}` };
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

const CDP_DISABLED_ACTIONS = new Set([
  ...TRADING_DISABLED_ACTIONS,
  'chain_get_balance',
  'chain_get_token_balance',
  'chain_send_token',
  'chain_swap',
  'chain_get_tx_status',
  'cex_get_balance',
  'cex_get_ticker',
  'cex_place_order',
  'cex_cancel_order',
  'cex_get_positions',
  'cex_withdraw',
]);

async function executeIdentityAction(
  action: Extract<TaskAction, { type: 'set_identity' }>,
  ctx: ExecutorContext
): Promise<string> {
  ctx.task.agentName = action.name;
  if (action.role) ctx.task.agentRole = action.role;
  ctx.task.updatedAt = Date.now();
  ctx.pushUpdate();
  return `Identity set: ${action.name}${action.role ? ` (${action.role})` : ''}`;
}

async function executeMonitorPosition(
  action: Extract<TaskAction, { type: 'monitor_position' }>,
  ctx: ExecutorContext
): Promise<string> {
  if (!ctx.taskManager) return '[Error: task manager not available for monitoring]';
  ctx.task.monitor = {
    venue: action.venue,
    tokenId: action.tokenId,
    entryPrice: action.entryPrice,
    size: action.size,
    takeProfitPrice: action.takeProfitPrice,
    stopLossPrice: action.stopLossPrice,
    intervalMs: action.intervalMs ?? 300_000,
    maxDurationMs: action.maxDurationMs ?? 7 * 24 * 60 * 60 * 1000,
    side: action.side,
    startedAt: Date.now(),
  };
  ctx.task.status = 'monitoring';
  ctx.task.updatedAt = Date.now();
  return '[Monitoring disabled - trading removed]';
}

export async function executeApiOnlyAction(action: TaskAction, ctx: ExecutorContext): Promise<string | undefined> {
  const raw = action as Record<string, unknown>;

  if (CDP_DISABLED_ACTIONS.has(action.type)) return '[Trading disabled]';

  if (INTER_TASK_ACTIONS.has(action.type))
    return unwrap(await executeInterTaskAction(ctx, action as Parameters<typeof executeInterTaskAction>[1]));
  if (FACT_ACTIONS.has(action.type))
    return unwrap(await executeFactAction(ctx, action as Parameters<typeof executeFactAction>[1]));
  if (MEMORY_ACTIONS.has(action.type))
    return unwrap(await executeMemoryAction(ctx, action as Parameters<typeof executeMemoryAction>[1]));
  if (action.type === 'set_identity') return executeIdentityAction(action, ctx);
  if (action.type === 'generate_image') return unwrap(await executeImageAction(ctx, action));
  if (action.type === 'monitor_position') return executeMonitorPosition(action, ctx);
  if (action.type === 'wait') {
    await sleep((raw.ms as number) ?? 1000);
    return undefined;
  }
  return `[Error: "${action.type}" is not available in API-only mode.]`;
}

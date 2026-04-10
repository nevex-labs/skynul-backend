/**
 * System-level position monitor.
 *
 * Periodically checks positions WITHOUT LLM calls.
 * When a take-profit or stop-loss condition is met, it auto-closes the position
 * and completes the task with a summary.
 */

import type { TaskManager } from '../../core/agent/task-manager';
import type { Task } from '../../types';
import { adjustPaperBalance, recordPaperTrade } from './paper-portfolio';
import { PolymarketClient } from './polymarket-client';

type MonitorEntry = {
  taskId: string;
  timer: ReturnType<typeof setInterval>;
};

const activeMonitors = new Map<string, MonitorEntry>();

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const DEFAULT_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function startPositionMonitor(task: Task, taskManager: TaskManager, paperMode: boolean): string {
  const m = task.monitor;
  if (!m) return '[Error: no monitor config on task]';

  // Don't double-start
  if (activeMonitors.has(task.id)) return 'Monitor already active.';

  const intervalMs = m.intervalMs || DEFAULT_INTERVAL_MS;

  const timer = setInterval(() => {
    void checkPosition(task.id, taskManager, paperMode);
  }, intervalMs);

  activeMonitors.set(task.id, { taskId: task.id, timer });

  console.log(
    `[monitor] Started for task ${task.id}: ${m.venue} ${m.tokenId.slice(0, 10)}... ` +
      `TP=$${m.takeProfitPrice} SL=$${m.stopLossPrice} interval=${intervalMs / 1000}s`
  );

  return (
    `Monitoring active. Checking every ${intervalMs / 60000} min. ` +
    `TP: $${m.takeProfitPrice}, SL: $${m.stopLossPrice}. ` +
    `I'll auto-close when conditions are met. Max duration: ${m.maxDurationMs / 3600000}h.`
  );
}

export function stopMonitor(taskId: string): void {
  const entry = activeMonitors.get(taskId);
  if (entry) {
    clearInterval(entry.timer);
    activeMonitors.delete(taskId);
    console.log(`[monitor] Stopped for task ${taskId}`);
  }
}

function isTerminalStatus(status: string): boolean {
  return status === 'cancelled' || status === 'failed' || status === 'completed';
}

function checkPriceThresholds(
  price: number,
  monitor: NonNullable<ReturnType<TaskManager['get']>>['monitor']
): 'take_profit' | 'stop_loss' | null {
  if (!monitor) return null;
  const isBuy = monitor.side === 'buy';
  if (isBuy ? price >= monitor.takeProfitPrice : price <= monitor.takeProfitPrice) return 'take_profit';
  if (isBuy ? price <= monitor.stopLossPrice : price >= monitor.stopLossPrice) return 'stop_loss';
  return null;
}

async function checkPosition(taskId: string, taskManager: TaskManager, paperMode: boolean): Promise<void> {
  const task = taskManager.get(taskId);
  if (!task?.monitor || isTerminalStatus(task.status)) {
    stopMonitor(taskId);
    return;
  }

  const m = task.monitor;
  const elapsed = Date.now() - m.startedAt;
  if (elapsed > (m.maxDurationMs || DEFAULT_MAX_DURATION_MS)) {
    await closeAndFinish(task, taskManager, paperMode, 'max_duration');
    return;
  }

  try {
    const currentPrice = await getCurrentPrice(m.venue, m.tokenId, paperMode);
    if (currentPrice === null) return;
    console.log(
      `[monitor] ${taskId}: ${m.tokenId.slice(0, 10)}... price=$${currentPrice.toFixed(4)} ` +
        `(entry=$${m.entryPrice}, TP=$${m.takeProfitPrice}, SL=$${m.stopLossPrice})`
    );
    const trigger = checkPriceThresholds(currentPrice, m);
    if (trigger) await closeAndFinish(task, taskManager, paperMode, trigger, currentPrice);
  } catch (e) {
    console.warn(`[monitor] Error checking position for ${taskId}:`, e);
  }
}

async function getCurrentPrice(venue: string, tokenId: string, _paperMode: boolean): Promise<number | null> {
  if (venue === 'polymarket') {
    try {
      // Always use live client for price checks — paper mode doesn't track prices
      const client = new PolymarketClient({ mode: 'live' });
      return await client.getTokenPrice(tokenId);
    } catch {
      return null;
    }
  }
  // TODO: CEX and on-chain price fetching
  return null;
}

async function closeAndFinish(
  task: Task,
  taskManager: TaskManager,
  paperMode: boolean,
  reason: 'take_profit' | 'stop_loss' | 'max_duration',
  currentPrice?: number
): Promise<void> {
  if (!task.monitor) return;
  const m = task.monitor;
  stopMonitor(task.id);

  try {
    if (paperMode) {
      const proceeds = m.size * (currentPrice ?? m.entryPrice);
      await adjustPaperBalance('USDC', proceeds);
      await recordPaperTrade({
        task_id: task.id,
        venue: m.venue,
        action_type: 'monitor_close',
        symbol: m.tokenId.slice(0, 16),
        side: 'sell',
        price: currentPrice,
        size: m.size,
        amount_usd: proceeds,
      });
    } else if (m.venue === 'polymarket') {
      const client = new PolymarketClient({ mode: 'live' });
      await client.closePosition({ tokenId: m.tokenId, size: m.size });
    }
  } catch (e) {
    console.error(`[monitor] Failed to close position for ${task.id}:`, e);
  }

  const pnl = currentPrice ? ((currentPrice - m.entryPrice) * m.size).toFixed(2) : 'unknown';
  const elapsed = ((Date.now() - m.startedAt) / 3600000).toFixed(1);

  const reasonText = {
    take_profit: 'Take profit hit',
    stop_loss: 'Stop loss hit',
    max_duration: 'Max monitoring duration reached',
  }[reason];

  const summary =
    `${reasonText}. Position closed.\n` +
    `Entry: $${m.entryPrice} → Exit: $${currentPrice?.toFixed(4) ?? '?'}\n` +
    `PnL: $${pnl} | Duration: ${elapsed}h`;

  task.summary = summary;
  task.status = 'completed';
  task.monitor = undefined;
  task.updatedAt = Date.now();
  taskManager.emit('taskUpdate', task);
}

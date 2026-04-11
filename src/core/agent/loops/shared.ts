/**
 * Shared utilities for loop implementations.
 * Eliminates duplication of sleep, unwrap, and common action type Sets.
 */

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function unwrap(res: { ok: boolean; value?: string; error?: string }): string {
  return res.ok ? (res.value ?? '') : `[Error: ${res.error}]`;
}

export const INTER_TASK_ACTIONS = new Set(['task_list_peers', 'task_send', 'task_read', 'task_message']);

export const FACT_ACTIONS = new Set(['remember_fact', 'forget_fact']);

export const MEMORY_ACTIONS = new Set(['memory_save', 'memory_search', 'memory_context']);

export const TRADING_DISABLED_ACTIONS = new Set([
  'polymarket_get_account_summary',
  'polymarket_get_trader_leaderboard',
  'polymarket_search_markets',
  'polymarket_place_order',
  'polymarket_close_position',
]);

export const FILE_ACTIONS = new Set(['file_read', 'file_write', 'file_edit', 'file_list']);

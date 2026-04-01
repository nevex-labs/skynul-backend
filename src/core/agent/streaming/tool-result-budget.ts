/**
 * Tool result budget — truncates large action results to keep context lean.
 * Pure functions, no side effects.
 */

/** Default max chars for a tool result before truncation. */
const DEFAULT_MAX_RESULT_CHARS = 8000;

/** Per-action-type overrides for tools that tend to produce large outputs. */
const ACTION_LIMITS: Record<string, number> = {
  shell: 12_000,
  file_read: 15_000,
  file_list: 10_000,
  file_search: 10_000,
  web_scrape: 12_000,
  memory_context: 10_000,
  memory_search: 10_000,
  polymarket_get_trader_leaderboard: 10_000,
};

export type BudgetConfig = {
  maxChars?: number;
  perActionLimits?: Record<string, number>;
};

/**
 * Apply budget to a result string.
 * Returns the (possibly truncated) result.
 */
export function budgetResult(result: string, actionType: string, config?: BudgetConfig): string {
  const limit = resolveLimit(actionType, config);

  if (result.length <= limit) return result;

  const head = Math.floor(limit * 0.6);
  const tail = limit - head;
  const omitted = result.length - head - tail;

  return `${result.slice(0, head)}\n\n[... ${omitted} chars truncated — full result too large for context ...]\n\n${result.slice(result.length - tail)}`;
}

/**
 * Check if a result exceeds the budget without truncating.
 */
export function exceedsBudget(result: string, actionType: string, config?: BudgetConfig): boolean {
  return result.length > resolveLimit(actionType, config);
}

/**
 * Resolve the character limit for an action type.
 * Priority: config.perActionLimits > config.maxChars > built-in > default.
 */
function resolveLimit(actionType: string, config?: BudgetConfig): number {
  return (
    config?.perActionLimits?.[actionType] ?? config?.maxChars ?? ACTION_LIMITS[actionType] ?? DEFAULT_MAX_RESULT_CHARS
  );
}

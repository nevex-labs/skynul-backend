/**
 * Tool Result Budgeting — persist large tool results to disk.
 *
 * When a tool result exceeds the configured limit, it is:
 * 1. Written to disk in .skynul/results/
 * 2. Replaced in context with a preview + file path
 *
 * This keeps the context lean while preserving full results for later reference.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { VisionMessage } from '../../../shared/types';
import { childLogger } from '../../logger';

const logger = childLogger({ component: 'tool-result-budget' });

/** Default max chars for a tool result before persisting to disk. */
export const DEFAULT_MAX_RESULT_CHARS = 8000;

/** Per-action-type overrides for tools that tend to produce large outputs. */
export const ACTION_LIMITS: Record<string, number> = {
  shell: 12_000,
  file_read: 15_000,
  file_list: 10_000,
  file_search: 10_000,
  web_scrape: 12_000,
  memory_context: 10_000,
  memory_search: 10_000,
  polymarket_get_trader_leaderboard: 10_000,
  browser_screenshot: 5000,
  browser_extract: 10_000,
};

export type ToolBudgetConfig = {
  /** Default max chars for any tool result */
  maxChars?: number;
  /** Per-action-type overrides */
  perActionLimits?: Record<string, number>;
  /** Directory to persist large results (default: .skynul/results) */
  persistDir?: string;
  /** Whether to persist to disk (default: true) */
  enablePersistence?: boolean;
  /** Preview chars to keep in context (default: 2000) */
  previewChars?: number;
};

export const DEFAULT_TOOL_BUDGET_CONFIG: Required<ToolBudgetConfig> = {
  maxChars: DEFAULT_MAX_RESULT_CHARS,
  perActionLimits: {},
  persistDir: '.skynul/results',
  enablePersistence: true,
  previewChars: 2000,
};

/**
 * Resolve the character limit for an action type.
 * Priority: config.perActionLimits > config.maxChars > built-in > default.
 */
export function resolveLimit(actionType: string, config?: ToolBudgetConfig): number {
  return (
    config?.perActionLimits?.[actionType] ?? config?.maxChars ?? ACTION_LIMITS[actionType] ?? DEFAULT_MAX_RESULT_CHARS
  );
}

/** Check if a result exceeds the budget. */
export function exceedsBudget(result: string, actionType: string, config?: ToolBudgetConfig): boolean {
  return result.length > resolveLimit(actionType, config);
}

/** Generate a unique filename for persisted result. */
function generateResultFilename(taskId: string, stepIndex: number, actionType: string): string {
  const timestamp = Date.now();
  const safeActionType = actionType.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${taskId}_step${stepIndex}_${safeActionType}_${timestamp}.txt`;
}

/** Ensure directory exists. */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Persist result to disk. Returns the file path. */
export function persistResult(
  result: string,
  taskId: string,
  stepIndex: number,
  actionType: string,
  config?: ToolBudgetConfig
): string {
  const cfg = { ...DEFAULT_TOOL_BUDGET_CONFIG, ...config };
  const filename = generateResultFilename(taskId, stepIndex, actionType);
  const filepath = `${cfg.persistDir}/${filename}`;

  try {
    ensureDir(dirname(filepath));
    writeFileSync(filepath, result, 'utf-8');
    logger.debug({ taskId, stepIndex, actionType, filepath, size: result.length }, 'Persisted large tool result');
    return filepath;
  } catch (error) {
    logger.error({ taskId, stepIndex, actionType, error }, 'Failed to persist tool result');
    throw new Error(`Failed to persist tool result: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export type BudgetApplyResult = {
  /** The (possibly truncated) result to use in context */
  result: string;
  /** Whether the result was persisted to disk */
  persisted: boolean;
  /** Path to persisted file (if persisted) */
  filepath?: string;
  /** Original result length */
  originalLength: number;
  /** Final result length */
  finalLength: number;
};

/**
 * Apply budget to a tool result.
 *
 * If result exceeds budget:
 * 1. Persist full result to disk
 * 2. Return preview + file path reference
 *
 * If result is within budget:
 * 1. Return result unchanged
 */
export function applyBudget(
  result: string,
  actionType: string,
  taskId: string,
  stepIndex: number,
  config?: ToolBudgetConfig
): BudgetApplyResult {
  const cfg = { ...DEFAULT_TOOL_BUDGET_CONFIG, ...config };
  const limit = resolveLimit(actionType, cfg);

  if (result.length <= limit) {
    return {
      result,
      persisted: false,
      originalLength: result.length,
      finalLength: result.length,
    };
  }

  // Check if persistence is enabled
  if (!cfg.enablePersistence) {
    const truncated = truncateResult(result, limit);
    return {
      result: truncated,
      persisted: false,
      originalLength: result.length,
      finalLength: truncated.length,
    };
  }

  // Persist to disk
  let filepath: string;
  try {
    filepath = persistResult(result, taskId, stepIndex, actionType, cfg);
  } catch (error) {
    // Fallback: truncate without persisting
    logger.warn({ taskId, stepIndex, actionType, error }, 'Persistence failed, truncating only');
    const truncated = truncateResult(result, limit);
    return {
      result: truncated,
      persisted: false,
      originalLength: result.length,
      finalLength: truncated.length,
    };
  }

  // Create preview with reference
  const preview = createResultPreview(result, filepath, cfg.previewChars);

  logger.info(
    {
      taskId,
      stepIndex,
      actionType,
      originalLength: result.length,
      previewLength: preview.length,
      filepath,
    },
    'Tool result budget applied'
  );

  return {
    result: preview,
    persisted: true,
    filepath,
    originalLength: result.length,
    finalLength: preview.length,
  };
}

/** Create a preview with file reference. */
function createResultPreview(result: string, filepath: string, previewChars: number): string {
  const headChars = Math.floor(previewChars * 0.6);
  const tailChars = Math.floor(previewChars * 0.3);

  const head = result.slice(0, headChars);
  const tail = result.slice(-tailChars);
  const omitted = result.length - headChars - tailChars;

  return `${head}\n\n[... ${omitted} chars omitted — full result persisted to: ${filepath} ...]\n\n${tail}`;
}

/** Truncate result to fit within limit (fallback when persistence fails). */
function truncateResult(result: string, limit: number): string {
  const head = Math.floor(limit * 0.6);
  const tail = limit - head;
  const omitted = result.length - head - tail;

  return `${result.slice(0, head)}\n\n[... ${omitted} chars truncated — result too large for context ...]\n\n${result.slice(-tail)}`;
}

export type CleanupResult = {
  /** Number of file references found */
  found: number;
  /** Number of files successfully removed */
  removed: number;
  /** Errors encountered */
  errors: string[];
};

/**
 * Extract file references from messages and clean up persisted results.
 * Called when a task completes to optionally remove persisted files.
 */
export function cleanupPersistedResults(messages: VisionMessage[], config?: ToolBudgetConfig): CleanupResult {
  const cfg = { ...DEFAULT_TOOL_BUDGET_CONFIG, ...config };
  const result: CleanupResult = { found: 0, removed: 0, errors: [] };

  // Extract file references from messages
  const refs: string[] = [];
  for (const msg of messages) {
    for (const part of msg.content || []) {
      if (!('text' in part)) continue;

      // Match "persisted to: <filepath>"
      const matches = part.text.match(/persisted to:\s*(.+?)(?:\s|$|\])/g);
      if (matches) {
        for (const match of matches) {
          const path = match
            .replace(/persisted to:\s*/, '')
            .replace(/\]$/, '')
            .trim();
          if (path && !refs.includes(path)) {
            refs.push(path);
          }
        }
      }
    }
  }

  result.found = refs.length;

  // Note: Actual file removal is optional and should be handled by task cleanup
  // This function just identifies what could be cleaned up

  return result;
}

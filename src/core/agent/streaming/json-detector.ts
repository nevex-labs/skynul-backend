/**
 * JSON detector — watches accumulated text for a complete JSON action.
 * Pure function, no side effects. Safe to call on every chunk.
 */

import type { TaskAction } from '../../../types';

const VALID_ACTION_TYPES = new Set([
  'click',
  'double_click',
  'type',
  'key',
  'scroll',
  'move',
  'launch',
  'web_scrape',
  'save_to_excel',
  'done',
  'fail',
  'navigate',
  'pressKey',
  'evaluate',
  'shell',
  'upload_file',
  'scrollIntoView',
  'file_read',
  'file_write',
  'file_edit',
  'file_list',
  'file_search',
  'polymarket_get_account_summary',
  'polymarket_get_trader_leaderboard',
  'polymarket_search_markets',
  'polymarket_place_order',
  'polymarket_close_position',
  'monitor_position',
  'chain_get_balance',
  'chain_get_token_balance',
  'chain_send_token',
  'chain_swap',
  'chain_get_tx_status',
  'cex_get_balance',
  'cex_place_order',
  'cex_cancel_order',
  'cex_get_positions',
  'cex_get_ticker',
  'cex_withdraw',
  'task_list_peers',
  'task_send',
  'task_read',
  'task_message',
  'plan',
  'task_spawn',
  'task_spawn_batch',
  'task_wait',
  'memory_save',
  'memory_search',
  'memory_context',
  'app_script',
  'set_identity',
  'generate_image',
  'user_message',
  'wait',
  'remember_fact',
  'forget_fact',
]);

export type DetectedAction = {
  thought?: string;
  action: TaskAction;
};

export type DetectionResult = { detected: false } | { detected: true; thought?: string; action: TaskAction };

/**
 * Try to detect a complete JSON action from accumulated text.
 * Returns { detected: false } if the text doesn't yet contain a complete action.
 */
export function detectAction(accumulated: string): DetectionResult {
  const cleaned = stripNoise(accumulated);

  // Strategy 1: direct JSON parse
  const direct = tryParse(cleaned);
  if (direct) return { detected: true, ...direct };

  // Strategy 2: markdown code fence
  const fenced = tryFencedParse(cleaned);
  if (fenced) return { detected: true, ...fenced };

  // Strategy 3: brace-balanced extraction
  const extracted = tryBraceExtract(cleaned);
  if (extracted) return { detected: true, ...extracted };

  return { detected: false };
}

/**
 * Extract the first complete JSON object from text using brace balancing.
 * Returns null if no complete object found yet (stream still in progress).
 */
export function extractFirstJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null; // incomplete — braces not balanced yet
}

// ── Internal helpers ────────────────────────────────────────────────────

const NOISE_REGEX =
  /\s*·?\s*(?:CDP\s+browser\s+bridge\s+ready|Bridge\s+ready)\.?\s*(Starting\s+agent\s+loop\.\.\.)?\s*/gi;

function stripNoise(text: string): string {
  return text.replace(NOISE_REGEX, ' ').trim();
}

function tryParse(text: string): DetectedAction | null {
  try {
    return validateParsed(JSON.parse(text));
  } catch {
    return null;
  }
}

function tryFencedParse(text: string): DetectedAction | null {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (!fenceMatch) return null;
  try {
    return validateParsed(JSON.parse(fenceMatch[1].trim()));
  } catch {
    return null;
  }
}

function tryBraceExtract(text: string): DetectedAction | null {
  const jsonStr = extractFirstJson(text);
  if (!jsonStr) return null;
  try {
    return validateParsed(JSON.parse(jsonStr));
  } catch {
    return null;
  }
}

function validateParsed(obj: unknown): DetectedAction | null {
  if (!obj || typeof obj !== 'object') return null;

  const rec = obj as Record<string, unknown>;
  let action = rec.action as Record<string, unknown> | undefined;
  const thought = typeof rec.thought === 'string' ? rec.thought : undefined;

  // Normalize alternative formats
  if (!action && rec.step && typeof rec.step === 'object') {
    const step = rec.step as Record<string, unknown>;
    if (Array.isArray(step.actions) && step.actions.length > 0) {
      action = step.actions[0] as Record<string, unknown>;
    }
  }

  if (!action && Array.isArray(rec.actions) && rec.actions.length > 0) {
    action = rec.actions[0] as Record<string, unknown>;
  }

  if (!action && typeof rec.type === 'string' && VALID_ACTION_TYPES.has(rec.type)) {
    action = rec;
  }

  if (!action || typeof action !== 'object' || !action.type) return null;
  if (!VALID_ACTION_TYPES.has(action.type as string)) return null;

  return { thought, action: action as unknown as TaskAction };
}

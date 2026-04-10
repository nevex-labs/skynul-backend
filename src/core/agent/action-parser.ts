/**
 * Extracts a TaskAction JSON from the model's raw response text.
 * The model should respond with raw JSON, but we handle edge cases
 * like markdown code fences or extra text around the JSON.
 */

import type { TaskAction } from '../../types';

type ModelResponse = {
  thought?: string;
  action: TaskAction;
};

export type ParserState = { consecutiveTruncations: number };

const MAX_TRUNCATION_RETRIES = 2;

/** Regex that matches status-log noise (allows optional · and whitespace/newlines). */
const NOISE_REGEX =
  /\s*·?\s*(?:CDP\s+browser\s+bridge\s+ready|Bridge\s+ready)\.?\s*(Starting\s+agent\s+loop\.\.\.)?\s*/gi;

/**
 * Remove status-log noise from anywhere in the string (middle or end).
 * This fixes responses where UI/stream concatenated our status with the model output.
 */
function stripEmbeddedNoise(text: string): string {
  return text.replace(NOISE_REGEX, ' ').trim();
}

/**
 * Strip trailing lines that look like status logs.
 */
function stripTrailingNoise(text: string): string {
  const lines = text.split('\n');
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (!last) {
      lines.pop();
      continue;
    }
    const looksLikeJson = /[{}[\]"]/.test(last);
    if (!looksLikeJson && (last.startsWith('·') || /Starting agent loop|bridge ready|CDP browser/i.test(last))) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join('\n').trim();
}

/**
 * Parse the model response into a thought + action.
 * Throws if the response cannot be parsed.
 */
export function parseModelResponse(raw: string, state?: ParserState): ModelResponse {
  const s = state ?? { consecutiveTruncations: 0 };
  let trimmed = raw.trim();
  trimmed = stripEmbeddedNoise(trimmed);
  trimmed = stripTrailingNoise(trimmed);

  // Try direct JSON parse first (single clean object)
  try {
    return validateResponse(JSON.parse(trimmed), s);
  } catch {
    // continue
  }

  // Try extracting JSON from markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return validateResponse(JSON.parse(fenceMatch[1].trim()), s);
    } catch {
      // continue
    }
  }

  // Extract the FIRST complete JSON object using brace balancing.
  // This handles cases where the model returns multiple JSONs concatenated.
  const firstJson = extractFirstJson(trimmed);
  if (firstJson) {
    try {
      return validateResponse(JSON.parse(firstJson), s);
    } catch {
      // continue
    }
  }

  // Fallback: tolerate invalid JSON in "thought" as long as "action" is well-formed.
  // This handles cases where the model's thought includes unescaped quotes or where
  // UI status logs were concatenated into the thought string, breaking JSON.parse.
  if (/^\s*\{\s*"thought"\s*:/.test(trimmed) && trimmed.includes('"action"')) {
    const thoughtMatch = trimmed.match(/"thought"\s*:\s*"(.*?)",\s*"action"/s);
    if (thoughtMatch) {
      const rawThought = thoughtMatch[1];
      const actionKeyIndex = trimmed.indexOf('"action"');
      if (actionKeyIndex !== -1) {
        const braceStart = trimmed.indexOf('{', actionKeyIndex);
        if (braceStart !== -1) {
          const actionJson = extractFirstJson(trimmed.slice(braceStart));
          if (actionJson) {
            try {
              const actionObj = JSON.parse(actionJson);
              return validateResponse(
                {
                  thought: rawThought,
                  action: actionObj,
                },
                s
              );
            } catch {
              // fall through to error below
            }
          }
        }
      }
    }
  }

  const preview = trimmed.slice(0, 200);

  // Truncated or malformed response: model generated a long thought and ran out
  // of tokens before producing the action. Recover with wait (up to MAX retries),
  // then fail cleanly to avoid infinite loops.
  if (/^\s*\{\s*"thought"\s*:/.test(trimmed)) {
    s.consecutiveTruncations++;
    if (s.consecutiveTruncations > MAX_TRUNCATION_RETRIES) {
      s.consecutiveTruncations = 0;
      return {
        thought: 'Model keeps generating truncated responses — aborting task',
        action: {
          type: 'fail',
          reason: 'Model output repeatedly truncated. Try a simpler task or shorter prompt.',
        } as unknown as TaskAction,
      };
    }
    console.warn(
      `[action-parser] Truncated response (${s.consecutiveTruncations}/${MAX_TRUNCATION_RETRIES}) — injecting wait`
    );
    // Extract partial thought to feed back to the model as context
    const partialThought = trimmed.match(/"thought"\s*:\s*"([\s\S]{0,200})/)?.[1] ?? '';
    // If the truncated response was trying to do a wait, recover the ms value
    const waitMsMatch = trimmed.match(/"ms"\s*:\s*(\d+)/);
    const recoveredMs = waitMsMatch ? Math.min(Number(waitMsMatch[1]), 3_600_000) : 500;
    return {
      thought: `(response truncated — thought was: "${partialThought}...") YOUR RESPONSE WAS CUT OFF. Keep thought under 30 words and respond with a COMPLETE JSON object.`,
      action: { type: 'wait', ms: recoveredMs } as unknown as TaskAction,
    };
  }

  throw new Error(`Could not parse model response as JSON action: ${preview}`);
}

/**
 * Extract the first complete JSON object from a string using brace balancing.
 * Handles strings and escaped characters correctly.
 */
function extractFirstJson(text: string): string | null {
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

  return null;
}

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
  // CDP browser agent actions
  'navigate',
  'pressKey',
  'evaluate',
  // Shell
  'shell',
  // CDP file upload
  'upload_file',
  // Scroll element into view
  'scrollIntoView',
  // Code mode file operations
  'file_read',
  'file_write',
  'file_edit',
  'file_list',
  'file_search',
  // Polymarket trading actions
  'polymarket_get_account_summary',
  'polymarket_get_trader_leaderboard',
  'polymarket_search_markets',
  'polymarket_place_order',
  'polymarket_close_position',
  'monitor_position',
  // On-chain trading actions
  'chain_get_balance',
  'chain_get_token_balance',
  'chain_send_token',
  'chain_swap',
  'chain_get_tx_status',
  // CEX trading actions
  'cex_get_balance',
  'cex_place_order',
  'cex_cancel_order',
  'cex_get_positions',
  'cex_get_ticker',
  'cex_withdraw',
  // Inter-task communication
  'task_list_peers',
  'task_send',
  'task_read',
  'task_message',
  // Orchestrator actions
  'plan',
  'task_spawn',
  'task_wait',
  // Knowledge memory
  'memory_save',
  'memory_search',
  'memory_context',
  // App scripting
  'app_script',
  // Sub-agent identity
  'set_identity',
  // Image generation
  'generate_image',
  // Batch browser actions
  'batch',
  // Keyboard type (for canvas-based UIs like Google Sheets)
  'keyboard_type',
  // Shell (in browser mode)
  'shell',
]);

function validateResponse(obj: unknown, state: ParserState): ModelResponse {
  if (!obj || typeof obj !== 'object') {
    throw new Error('Response is not an object');
  }

  const rec = obj as Record<string, unknown>;
  let action = rec.action as Record<string, unknown> | undefined;
  const thought = typeof rec.thought === 'string' ? rec.thought : undefined;

  // Normalize alternative formats from local models (e.g. llama3)
  // Format: { "step": { "actions": [{ "type": "navigate", ... }] } }
  if (!action && rec.step && typeof rec.step === 'object') {
    const step = rec.step as Record<string, unknown>;
    if (Array.isArray(step.actions) && step.actions.length > 0) {
      action = step.actions[0] as Record<string, unknown>;
    }
  }

  // Format: { "actions": [{ "type": "navigate", ... }] }
  if (!action && Array.isArray(rec.actions) && rec.actions.length > 0) {
    action = rec.actions[0] as Record<string, unknown>;
  }

  // Format: { "type": "navigate", ... } (action at root level, no wrapper)
  if (!action && typeof rec.type === 'string' && VALID_ACTION_TYPES.has(rec.type)) {
    action = rec as Record<string, unknown>;
  }

  if (!action || typeof action !== 'object' || !action.type) {
    throw new Error('Response missing action.type');
  }

  if (!VALID_ACTION_TYPES.has(action.type as string)) {
    throw new Error(`Unknown action type: ${action.type}`);
  }

  // Reset truncation counter only on a fully successful parse
  state.consecutiveTruncations = 0;

  return {
    thought,
    action: action as unknown as TaskAction,
  };
}

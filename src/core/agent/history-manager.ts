/**
 * History management utilities for the agent loop.
 * Handles message compression, action logging, and inbox draining.
 */

import type { TaskStep } from '../../types';
import type { VisionMessage } from '../providers/codex-vision';
import type { TaskManager } from './task-manager';

/** Extract action type from an assistant message text. */
function extractActionType(text: string): string {
  const match = text.match(/"type"\s*:\s*"([^"]+)"/);
  return match ? match[1] : '';
}

/** Compress history in browser/CDP mode: keep first msg + last N, summarize the rest. */
export function compressHistory(history: VisionMessage[], keepTail = 6): void {
  if (history.length <= 8) return;
  const oldMessages = history.slice(1, history.length - keepTail);
  const summary = oldMessages
    .filter((m) => m.role === 'assistant')
    .map((m) => {
      const txt = m.content?.[0] && 'text' in m.content[0] ? m.content[0].text : '';
      return extractActionType(txt);
    })
    .filter(Boolean)
    .join(' → ');
  history.splice(1, oldMessages.length, {
    role: 'user',
    content: [{ type: 'input_text', text: `[Previous actions: ${summary}]` }],
  });
}

/** Truncate history in code mode: keep first N messages only. */
export function truncateHistory(history: VisionMessage[], keepCount = 19): void {
  if (history.length <= keepCount) return;
  history.splice(1, history.length - keepCount);
}

/** Build a human-readable action log string from recent steps. */
export function buildActionLog(
  steps: TaskStep[],
  maxRecent = 8,
  opts?: { includeFailedSelectors?: boolean; truncateResult?: number; truncateError?: number }
): string {
  const recent = steps.slice(-maxRecent);
  const failedSelectors = new Set<string>();

  if (opts?.includeFailedSelectors) {
    for (const s of steps) {
      if (s.error) {
        const raw = s.action as Record<string, unknown>;
        if (raw.selector) failedSelectors.add(String(raw.selector));
      }
    }
  }

  const lines = recent.map((s) => {
    const res = s.result ? ` → ${s.result.slice(0, opts?.truncateResult ?? 200)}` : '';
    const err = s.error ? ` [ERROR: ${s.error.slice(0, opts?.truncateError ?? 100)}]` : '';
    const truncNote = s.thought?.includes('truncated')
      ? ' [YOUR RESPONSE WAS TRUNCATED — keep thought under 30 words]'
      : '';
    return `Step ${s.index + 1}: ${s.action.type}${res}${err}${truncNote}`;
  });

  let log = '\n\nRecent actions:\n' + lines.join('\n') + '\n\nDo NOT repeat actions that already succeeded.';

  if (opts?.includeFailedSelectors && failedSelectors.size > 0) {
    log +=
      '\n\n⚠ FAILED SELECTORS (do NOT use these again, try a completely different approach):\n' +
      [...failedSelectors].map((s) => `- ${s}`).join('\n');
  }

  return log;
}

/** Drain inter-task messages and return them as a text block. */
export function drainInbox(tm: TaskManager | null, taskId: string): string {
  if (!tm) return '';
  const msgs = tm.drainMessages(taskId);
  if (msgs.length === 0) return '';
  const lines = msgs.map((m) => `  From ${m.from}: ${m.message}`).join('\n');
  return `\n\n[INCOMING MESSAGES]\n${lines}\n[/INCOMING MESSAGES]`;
}

/**
 * History management utilities for the agent loop.
 * Handles message compression, action logging, and inbox draining.
 */

import type { TaskStep, VisionContentPart } from '../../shared/types';
import type { VisionMessage } from '../../shared/types';
import type { ProviderId } from '../../shared/types';
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
    const actionData = s.action as Record<string, unknown>;
    let extra = '';
    if (s.action.type === 'user_message' && actionData.text) {
      extra = `: "${String(actionData.text).slice(0, opts?.truncateResult ?? 200)}"`;
    } else if (s.action.type === 'done' && actionData.summary) {
      extra = `: "${String(actionData.summary).slice(0, opts?.truncateResult ?? 200)}"`;
    } else if (s.action.type === 'fail' && actionData.reason) {
      extra = `: "${String(actionData.reason).slice(0, opts?.truncateResult ?? 200)}"`;
    }
    return `Step ${s.index + 1}: ${s.action.type}${extra}${res}${err}${truncNote}`;
  });

  let log = '\n\nRecent actions:\n' + lines.join('\n') + '\n\nDo NOT repeat actions that already succeeded.';

  if (opts?.includeFailedSelectors && failedSelectors.size > 0) {
    log +=
      '\n\n⚠ FAILED SELECTORS (do NOT use these again, try a completely different approach):\n' +
      [...failedSelectors].map((s) => `- ${s}`).join('\n');
  }

  return log;
}

/** Map provider to its cheapest/fastest model for summarization. */
export function getSummarizationModel(provider: ProviderId): string {
  const map: Partial<Record<ProviderId, string>> = {
    chatgpt: 'gpt-4.1-nano',
    claude: 'claude-haiku-4-5-20251001',
    gemini: 'gemini-2.0-flash',
    deepseek: 'deepseek-chat',
    glm: 'glm-4-flash',
    minimax: 'MiniMax-Text-01',
    kimi: 'moonshot-v1-8k',
  };
  return map[provider] ?? provider;
}

/**
 * Summarize old history messages via a cheap LLM call.
 * Preserves first message + last 6 messages, replaces middle with summary.
 * Returns true if summarization occurred, false if skipped.
 */
export async function summarizeHistory(
  history: VisionMessage[],
  provider: ProviderId,
  taskId: string
): Promise<boolean> {
  if (history.length <= 10) return false;

  // Already summarized — don't re-summarize
  const alreadySummarized = history.some((m) =>
    m.content?.some((c) => 'text' in c && c.text.includes('[HISTORY SUMMARY]'))
  );
  if (alreadySummarized) return false;

  const middle = history.slice(1, -6);
  if (middle.length === 0) return false;

  // Extract text from middle messages
  const text = middle
    .map((m) =>
      m.content
        ?.filter((c): c is Extract<VisionContentPart, { text: string }> => 'text' in c)
        .map((c) => `${m.role}: ${c.text}`)
        .join('\n')
    )
    .filter(Boolean)
    .join('\n');

  // Lazy import to avoid loading vision stack for loops that never hit L3
  const { callVision } = await import('./vision-dispatch');

  const prompt =
    'Summarize this agent conversation history concisely. ' +
    'PRESERVE: decisions made, current positions/holdings, prices/thresholds, ' +
    'errors encountered, pending goals. Under 400 words.';

  const model = getSummarizationModel(provider);
  const result = await callVision(
    provider,
    prompt,
    [{ role: 'user', content: [{ type: 'input_text', text }] }],
    taskId,
    model
  );

  history.splice(1, middle.length, {
    role: 'user',
    content: [{ type: 'input_text', text: `[HISTORY SUMMARY]\n${result.text}\n[/HISTORY SUMMARY]` }],
  });

  return true;
}

/** Drain inter-task messages and return them as a text block. */
export function drainInbox(tm: TaskManager | null, taskId: string): string {
  if (!tm) return '';
  const msgs = tm.drainMessages(taskId);
  if (msgs.length === 0) return '';
  const lines = msgs.map((m) => `  From ${m.from}: ${m.message}`).join('\n');
  return `\n\n[INCOMING MESSAGES]\n${lines}\n[/INCOMING MESSAGES]`;
}

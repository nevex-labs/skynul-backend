/**
 * Layer 3: Agent Loop (ReAct Pattern)
 *
 * The core execution loop: THINK → ACT → OBSERVE → repeat.
 *
 * This layer is self-contained. It only depends on:
 * - Layer 2 types (ChatMessage, ProviderId)
 * - Its own type definitions
 *
 * It does NOT know about:
 * - Secrets or provider resolution
 * - Task CRUD or lifecycle
 * - Database or file storage
 * - Specific provider implementations
 */

import type { ChatMessage, ProviderId } from './provider-dispatch';
export type { ChatMessage, ProviderId } from './provider-dispatch';

// ── Types ──────────────────────────────────────────────────────────────

export type TaskAction =
  | { type: 'done'; summary?: string }
  | { type: 'fail'; reason: string }
  | { type: string; [key: string]: unknown };

export type TaskStep = {
  index: number;
  timestamp: number;
  action: TaskAction;
  thought?: string;
  result?: string;
  error?: string;
  contextTokens?: { used: number; max: number };
};

export type LoopCallbacks = {
  /** Execute an action requested by the LLM. Returns the result text. */
  executeAction(action: TaskAction): Promise<string | undefined>;

  /** Check if the loop should be aborted */
  isAborted(): boolean;

  /** Push a status update to the UI */
  pushStatus?(msg: string): void;

  /** Record a completed step (for external tracking) */
  recordStep?(step: TaskStep): void;

  /** Stream partial thinking text (optional, for real-time UI) */
  pushThinking?(taskId: string, stepIndex: number, partial: string): void;

  /** Only these action types are allowed. Empty/undefined = all allowed. */
  allowedTools?: string[];
};

export type LoopOpts = {
  /** System prompt that defines agent behavior and available tools */
  systemPrompt: string;

  /** Conversation history (messages so far) */
  history: ChatMessage[];

  /** Which LLM provider to use (already resolved by Layer 1) */
  provider: ProviderId;

  /** Function to call the LLM (injected from Layer 2) */
  callLLM: (messages: ChatMessage[]) => Promise<string>;

  /** Callbacks for action execution and status updates */
  callbacks: LoopCallbacks;

  /** Maximum number of steps before forcing termination */
  maxSteps: number;

  /** Optional: context window in tokens (for budget tracking) */
  contextWindow?: number;

  /** Optional: task ID for logging */
  taskId?: string;
};

export type LoopResult = {
  /** Final task status */
  status: 'completed' | 'failed' | 'cancelled' | 'max_steps';

  /** All steps executed */
  steps: TaskStep[];

  /** Summary if completed, error if failed */
  summary?: string;
  error?: string;

  /** Token usage if available */
  usage?: { inputTokens: number; outputTokens: number };
};

// ── Action Parser ──────────────────────────────────────────────────────

/**
 * Parse the LLM's raw response into a thought + action.
 *
 * Expected format (flexible):
 * - JSON: {"thought": "...", "action": {"type": "done", "summary": "..."}}
 * - Text: The model may return plain text, in which case we treat it as a done action.
 */
export function parseActionResponse(raw: string): {
  thought: string | undefined;
  action: TaskAction;
} {
  const trimmed = raw.trim();

  // Try to extract JSON from the response
  const jsonMatch = extractJsonObject(trimmed);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch);
      const thought = parsed.thought ?? parsed.reasoning ?? undefined;
      const action = parsed.action ?? parsed;

      if (typeof action === 'object' && action.type) {
        return { thought, action: action as TaskAction };
      }
    } catch {
      // Fall through to text parsing
    }
  }

  // No valid JSON — treat as plain text response (implicit done)
  return {
    thought: undefined,
    action: { type: 'done', summary: trimmed },
  };
}

function extractJsonObject(text: string): string | null {
  // Try fenced code block
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)```/m.exec(text);
  if (fence) return fence[1].trim();

  // Try to find { ... } in the text
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) return null;
  return text.slice(start, end + 1);
}

// ── Context Budget ─────────────────────────────────────────────────────

/**
 * Estimate token count for a message (rough: ~4 chars per token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate the current context budget.
 */
function calculateBudget(
  systemPrompt: string,
  history: ChatMessage[],
  contextWindow?: number
): { used: number; max: number; pct: number } {
  const max = contextWindow ?? 128_000; // Default: Gemini 2.5 Flash context
  const systemTokens = estimateTokens(systemPrompt);
  const historyTokens = history.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const used = systemTokens + historyTokens;
  return { used, max, pct: Math.round((used / max) * 100) };
}

// ── History Management ─────────────────────────────────────────────────

/**
 * Truncate history to fit within a token budget.
 * Keeps the most recent messages and drops the oldest.
 */
function trimHistory(
  history: ChatMessage[],
  systemPrompt: string,
  maxTokens: number,
  reserveTokens = 4096
): ChatMessage[] {
  const available = maxTokens - estimateTokens(systemPrompt) - reserveTokens;
  if (available <= 0) return history.slice(-2); // Keep at least last 2 messages

  const trimmed: ChatMessage[] = [];
  let used = 0;

  // Add from newest to oldest
  for (let i = history.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(history[i].content);
    if (used + tokens > available) break;
    trimmed.unshift(history[i]);
    used += tokens;
  }

  return trimmed;
}

// ── Main Loop ──────────────────────────────────────────────────────────

/**
 * Run the ReAct loop for a task.
 *
 * Cycle per turn:
 * 1. THINK  → callLLM(systemPrompt + history) → thought + action
 * 2. ACT    → callbacks.executeAction(action) → result
 * 3. OBSERVE → append result to history
 * 4. CHECK  → done/fail/continue → repeat or exit
 */
export async function runAgentLoop(opts: LoopOpts): Promise<LoopResult> {
  const { systemPrompt, history, provider, callLLM, callbacks, maxSteps, contextWindow, taskId } = opts;

  const steps: TaskStep[] = [];
  let status: LoopResult['status'] = 'max_steps';
  let summary: string | undefined;
  let error: string | undefined;

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    // Check abort
    if (callbacks.isAborted()) {
      status = 'cancelled';
      break;
    }

    // Update status
    callbacks.pushStatus?.('Thinking...');

    // Calculate context budget
    const budget = calculateBudget(systemPrompt, history, contextWindow);

    // Trim history if context is getting full (>80%)
    if (budget.pct > 80) {
      const trimmed = trimHistory(history, systemPrompt, budget.max);
      history.length = 0;
      history.push(...trimmed);
    }

    // Build the full message list (system + history)
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...history];

    // ── THINK ──
    let rawResponse: string;
    try {
      rawResponse = await callLLM(messages);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      status = 'failed';
      const step: TaskStep = {
        index: stepIndex,
        timestamp: Date.now(),
        action: { type: 'fail', reason: error },
        error,
        contextTokens: { used: budget.used, max: budget.max },
      };
      steps.push(step);
      callbacks.recordStep?.(step);
      break;
    }

    // ── PARSE ──
    const { thought, action } = parseActionResponse(rawResponse);

    // Record assistant response in history
    history.push({ role: 'assistant', content: rawResponse });

    // ── CHECK terminal actions ──
    if (action.type === 'done') {
      status = 'completed';
      summary = (action as { summary?: string }).summary;
      const step: TaskStep = {
        index: stepIndex,
        timestamp: Date.now(),
        action,
        thought,
        contextTokens: { used: budget.used, max: budget.max },
      };
      steps.push(step);
      callbacks.recordStep?.(step);
      break;
    }

    if (action.type === 'fail') {
      status = 'failed';
      error = (action as { reason: string }).reason;
      const step: TaskStep = {
        index: stepIndex,
        timestamp: Date.now(),
        action,
        thought,
        error,
        contextTokens: { used: budget.used, max: budget.max },
      };
      steps.push(step);
      callbacks.recordStep?.(step);
      break;
    }

    // ── ACT ──
    let result: string | undefined;
    let stepError: string | undefined;

    // Check allowed tools
    if (callbacks.allowedTools && callbacks.allowedTools.length > 0 && !callbacks.allowedTools.includes(action.type)) {
      stepError = `Action "${action.type}" is not allowed. Allowed: ${callbacks.allowedTools.join(', ')}`;
    } else {
      try {
        callbacks.pushStatus?.(`Executing: ${action.type}`);
        result = await callbacks.executeAction(action);
      } catch (err) {
        stepError = err instanceof Error ? err.message : String(err);
      }
    }

    // ── OBSERVE ──
    const observation = stepError ? `Error: ${stepError}` : (result ?? '(no output)');

    history.push({ role: 'user', content: `[Tool result: ${action.type}]\n${observation}` });

    // Record step
    const step: TaskStep = {
      index: stepIndex,
      timestamp: Date.now(),
      action,
      thought,
      result: stepError ? undefined : result,
      error: stepError,
      contextTokens: { used: budget.used, max: budget.max },
    };
    steps.push(step);
    callbacks.recordStep?.(step);

    // Check abort after action
    if (callbacks.isAborted()) {
      status = 'cancelled';
      break;
    }
  }

  // If we exited the loop without a terminal action, it means max steps
  if (status === 'max_steps') {
    error = `Reached max steps (${maxSteps})`;
  }

  return { status, steps, summary, error };
}

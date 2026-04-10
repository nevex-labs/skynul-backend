/**
 * Context Budget — token estimation and compression budget for agent loops.
 *
 * Tracks how much of the model's context window is used before each LLM call.
 * When usage crosses thresholds, signals which compression levels to apply.
 */

import type { ProviderId, VisionMessage } from '../../types';

// ── Context window sizes by provider:model ────────────────────────────────────
// Values are approximate. Override via options/env where supported.

const CONTEXT_WINDOWS: Record<string, number> = {
  'chatgpt:gpt-4.1': 1_047_576,
  'chatgpt:gpt-4.1-mini': 1_047_576,
  'chatgpt:gpt-4.1-nano': 1_047_576,
  'chatgpt:gpt-4o': 128_000,
  'chatgpt:gpt-4o-mini': 128_000,
  'chatgpt:o3': 200_000,
  'chatgpt:o4-mini': 200_000,
  'claude:claude-opus-4-6': 200_000,
  'claude:claude-sonnet-4-6': 200_000,
  'claude:claude-haiku-4-5': 200_000,
  'openrouter:default': 128_000,
  'ollama:default': 32_000,
};

/** Provider-level fallback when model is unknown. */
const PROVIDER_DEFAULTS: Record<ProviderId, number> = {
  chatgpt: 128_000,
  claude: 200_000,
  openrouter: 128_000,
  ollama: 32_000,
};

export function getContextWindow(provider: ProviderId, model?: string, override?: number): number {
  if (override && override > 0) return override;
  if (model) {
    const key = `${provider}:${model}`;
    if (CONTEXT_WINDOWS[key]) return CONTEXT_WINDOWS[key];
  }
  return PROVIDER_DEFAULTS[provider] ?? 128_000;
}

// ── Token estimation ──────────────────────────────────────────────────────────

/** Fast character-based token estimate (~4 chars/token for EN/ES). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate tokens for a base64 image (detail=auto is ~800 tokens conservatively). */
export function estimateImageTokens(detail: 'auto' | 'low' | 'high' = 'auto'): number {
  return detail === 'low' ? 85 : 800;
}

/** Estimate total tokens of the payload that will be sent to the LLM. */
export function estimatePayloadTokens(systemPrompt: string, messages: VisionMessage[]): number {
  let tokens = estimateTokens(systemPrompt);
  for (const msg of messages) {
    for (const part of msg.content) {
      if ('text' in part) {
        tokens += estimateTokens(part.text);
      } else if (part.type === 'input_image') {
        tokens += estimateImageTokens('auto');
      }
    }
  }
  return tokens;
}

// ── Budget computation ────────────────────────────────────────────────────────

export type ContextBudget = {
  /** Estimated tokens used (or provider-reported from last turn). */
  usedTokens: number;
  /** Whether usedTokens is an estimate (true) or provider-reported (false). */
  estimated: boolean;
  /** Total context window for this provider/model. */
  maxTokens: number;
  /** Ratio 0.0–1.0. */
  contextPct: number;
  /** Level 1: reduce memory/facts/skills injection counts. */
  applyLevel1: boolean;
  /** Level 2: switch to compact system prompt. */
  applyLevel2: boolean;
  /** Level 3: summarize old history entries via LLM. */
  applyLevel3: boolean;
};

const THRESHOLD_L1 = 0.45;
const THRESHOLD_L2 = 0.55;
const THRESHOLD_L3 = 0.65;

export function computeBudget(
  systemPrompt: string,
  messages: VisionMessage[],
  provider: ProviderId,
  model?: string,
  contextWindowOverride?: number,
  reportedInputTokens?: number
): ContextBudget {
  const maxTokens = getContextWindow(provider, model, contextWindowOverride);
  const estimated = reportedInputTokens === undefined;
  const usedTokens = reportedInputTokens ?? estimatePayloadTokens(systemPrompt, messages);
  const contextPct = usedTokens / maxTokens;

  return {
    usedTokens,
    estimated,
    maxTokens,
    contextPct,
    applyLevel1: contextPct > THRESHOLD_L1,
    applyLevel2: contextPct > THRESHOLD_L2,
    applyLevel3: contextPct > THRESHOLD_L3,
  };
}

/**
 * Reactive 413 Recovery — handle "Prompt Too Long" errors from LLM APIs.
 *
 * When an API returns 413 (or equivalent "context length exceeded" error),
 * progressively apply compaction strategies:
 * 1. Try snip compaction
 * 2. Try auto-compact
 * 3. Try model fallback (smaller context window)
 * 4. Fail with clear error
 *
 * Never fails silently — always reports what was attempted.
 */

import type { ProviderId } from '../../../types';
import type { VisionMessage } from '../../../types';
import { childLogger } from '../../logger';
import { DEFAULT_AUTO_COMPACT_CONFIG, autoCompact, getSummarizationModel } from './auto-compact';
import { DEFAULT_SNIP_CONFIG, snipHistory } from './snip-compaction';

const logger = childLogger({ component: 'reactive-recovery' });

/** Error codes that indicate context length issues. */
const CONTEXT_LENGTH_ERRORS = [
  '413',
  'context_length_exceeded',
  'max_tokens_exceeded',
  'prompt_too_long',
  'token_limit_exceeded',
  'too many tokens',
  'context window',
];

/** Check if an error is a context length error. */
export function isContextLengthError(error: unknown): boolean {
  // Handle Error objects
  if (error instanceof Error) {
    const errorStr = error.message.toLowerCase();
    return CONTEXT_LENGTH_ERRORS.some((code) => errorStr.includes(code.toLowerCase()));
  }

  // Handle objects with code/message properties (common API error format)
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    const codeStr = String(obj.code || '').toLowerCase();
    const messageStr = String(obj.message || '').toLowerCase();
    return CONTEXT_LENGTH_ERRORS.some((c) => codeStr.includes(c.toLowerCase()) || messageStr.includes(c.toLowerCase()));
  }

  // Handle primitive values
  const errorStr = String(error).toLowerCase();
  return CONTEXT_LENGTH_ERRORS.some((code) => errorStr.includes(code.toLowerCase()));
}

/** Model fallback options for each provider (smaller context models). */
const MODEL_FALLBACKS: Partial<Record<ProviderId, string[]>> = {
  chatgpt: ['gpt-4.1-nano', 'gpt-4o-mini'],
  claude: ['claude-haiku-4-5-20251001'],
  gemini: ['gemini-2.0-flash'],
  deepseek: ['deepseek-chat'],
  kimi: ['moonshot-v1-8k'],
  glm: ['glm-4-flash'],
  ollama: ['llama3.2', 'phi3'],
};

export type RecoveryAttempt = {
  strategy: 'snip' | 'compact' | 'fallback';
  success: boolean;
  details: string;
  tokensBefore?: number;
  tokensAfter?: number;
};

export type RecoveryResult = {
  recovered: boolean;
  history: VisionMessage[];
  fallbackModel?: string;
  attempts: RecoveryAttempt[];
  error?: string;
};

export type RecoveryConfig = {
  /** Max recovery attempts per error (default: 3) */
  maxAttempts: number;
  /** Try model fallback if compaction fails (default: true) */
  tryModelFallback: boolean;
  /** Min tokens to consider recovery successful (default: 1000) */
  minTokensReduction: number;
};

export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  maxAttempts: 3,
  tryModelFallback: true,
  minTokensReduction: 1000,
};

/**
 * Attempt reactive recovery from a context length error.
 *
 * Strategy:
 * 1. Try aggressive snip (more aggressive than normal)
 * 2. Try auto-compact with lower threshold
 * 3. Try model fallback
 * 4. Return failure with full attempt history
 */
export async function attemptRecovery(
  error: unknown,
  history: VisionMessage[],
  usedTokens: number,
  maxTokens: number,
  provider: ProviderId,
  currentModel: string,
  taskId: string,
  config?: Partial<RecoveryConfig>
): Promise<RecoveryResult> {
  const cfg = { ...DEFAULT_RECOVERY_CONFIG, ...config };
  const attempts: RecoveryAttempt[] = [];
  let currentTokens = usedTokens;

  logger.warn(
    {
      taskId,
      error: String(error),
      usedTokens,
      maxTokens,
      pct: ((usedTokens / maxTokens) * 100).toFixed(1) + '%',
    },
    'Starting reactive 413 recovery'
  );

  // Strategy 1: Aggressive snip
  if (attempts.length < cfg.maxAttempts) {
    const aggressiveSnipConfig = {
      ...DEFAULT_SNIP_CONFIG,
      thresholdPct: 0.5, // Snip even at 50%
      targetPct: 0.4,
      preserveRecent: 4, // Keep fewer messages
    };

    const snipResult = snipHistory(history, currentTokens, maxTokens, aggressiveSnipConfig);

    attempts.push({
      strategy: 'snip',
      success: snipResult.snipped,
      details: snipResult.reason,
      tokensBefore: snipResult.tokensBefore,
      tokensAfter: snipResult.tokensAfter,
    });

    if (snipResult.snipped) {
      const reduction = snipResult.tokensBefore - snipResult.tokensAfter;
      logger.info(
        {
          taskId,
          reduction,
          newPct: ((snipResult.tokensAfter / maxTokens) * 100).toFixed(1) + '%',
        },
        'Snip recovery successful'
      );

      if (reduction >= cfg.minTokensReduction) {
        return {
          recovered: true,
          history,
          attempts,
        };
      }
    }

    // Update token count for next strategy
    currentTokens = snipResult.tokensAfter;
  }

  // Strategy 2: Force auto-compact
  if (attempts.length < cfg.maxAttempts) {
    const aggressiveCompactConfig = {
      ...DEFAULT_AUTO_COMPACT_CONFIG,
      thresholdPct: 0.5, // Compact even at 50%
      preserveRecent: 3,
    };

    try {
      const compactResult = await autoCompact(
        history,
        usedTokens,
        maxTokens,
        provider,
        taskId,
        aggressiveCompactConfig
      );

      attempts.push({
        strategy: 'compact',
        success: compactResult.compacted,
        details: compactResult.error || 'Auto-compact completed',
        tokensBefore: compactResult.tokensBefore,
        tokensAfter: compactResult.tokensAfter,
      });

      if (compactResult.compacted) {
        const reduction = compactResult.tokensBefore - compactResult.tokensAfter;
        logger.info(
          {
            taskId,
            reduction,
            newPct: ((compactResult.tokensAfter / maxTokens) * 100).toFixed(1) + '%',
          },
          'Auto-compact recovery successful'
        );

        if (reduction >= cfg.minTokensReduction) {
          return {
            recovered: true,
            history,
            attempts,
          };
        }
      }

      currentTokens = compactResult.tokensAfter;
    } catch (compactError) {
      attempts.push({
        strategy: 'compact',
        success: false,
        details: `Auto-compact threw: ${compactError instanceof Error ? compactError.message : String(compactError)}`,
      });
    }
  }

  // Strategy 3: Model fallback
  if (cfg.tryModelFallback && attempts.length < cfg.maxAttempts) {
    const fallbacks = MODEL_FALLBACKS[provider];

    if (fallbacks && fallbacks.length > 0) {
      // Find a fallback different from current
      const fallbackModel = fallbacks.find((m) => m !== currentModel) || fallbacks[0];

      logger.info(
        {
          taskId,
          fromModel: currentModel,
          toModel: fallbackModel,
        },
        'Attempting model fallback'
      );

      attempts.push({
        strategy: 'fallback',
        success: true,
        details: `Fallback to ${fallbackModel}`,
      });

      return {
        recovered: true,
        history,
        fallbackModel,
        attempts,
      };
    }

    attempts.push({
      strategy: 'fallback',
      success: false,
      details: `No fallback models available for ${provider}`,
    });
  }

  // All strategies failed
  const attemptSummary = attempts.map((a) => `${a.strategy}:${a.success ? 'ok' : 'fail'}`).join(', ');
  const finalError = `Context length recovery failed after ${attempts.length} attempts (${attemptSummary}). Manual intervention required.`;

  logger.error(
    {
      taskId,
      attempts: attemptSummary,
      finalTokens: usedTokens,
      maxTokens,
    },
    'Reactive recovery failed'
  );

  return {
    recovered: false,
    history,
    attempts,
    error: finalError,
  };
}

/**
 * Format recovery attempt history for user-facing error messages.
 */
export function formatRecoveryReport(result: RecoveryResult): string {
  const lines = ['Context Length Recovery Attempted:', ''];

  for (const attempt of result.attempts) {
    const status = attempt.success ? '✓' : '✗';
    const tokenChange =
      attempt.tokensBefore && attempt.tokensAfter ? ` (${attempt.tokensBefore} → ${attempt.tokensAfter} tokens)` : '';
    lines.push(`  ${status} ${attempt.strategy}: ${attempt.details}${tokenChange}`);
  }

  if (result.fallbackModel) {
    lines.push('', `Fallback model suggested: ${result.fallbackModel}`);
  }

  if (result.error) {
    lines.push('', `Final error: ${result.error}`);
  }

  return lines.join('\n');
}

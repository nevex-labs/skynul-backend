/**
 * Auto-Compact — LLM-driven summarization when snipping isn't enough.
 *
 * Uses a forked agent to generate a summary of old messages.
 * Features:
 * - Circuit breaker: stops after N consecutive failures
 * - Re-injection of critical files the model was working on
 * - Preserves system context and recent messages
 */

import type { ProviderId } from '../../../types';
import type { VisionMessage } from '../../../types';
import { childLogger } from '../../logger';

const logger = childLogger({ component: 'auto-compact' });

export type AutoCompactConfig = {
  /** Context percentage threshold to trigger auto-compact (default: 0.95) */
  thresholdPct: number;
  /** Target context percentage after compaction (default: 0.50) */
  targetPct: number;
  /** Max consecutive failures before circuit breaker opens (default: 3) */
  maxFailures: number;
  /** Number of recent messages to preserve (default: 6) */
  preserveRecent: number;
  /** Timeout for summarization call in ms (default: 30000) */
  timeoutMs: number;
};

export const DEFAULT_AUTO_COMPACT_CONFIG: AutoCompactConfig = {
  thresholdPct: 0.95,
  targetPct: 0.5,
  maxFailures: 3,
  preserveRecent: 6,
  timeoutMs: 30000,
};

/** Circuit breaker state for auto-compact. */
type CircuitBreaker = {
  failures: number;
  lastFailureTime: number | null;
  isOpen: boolean;
};

/** Global circuit breaker state (per-process). */
const circuitBreaker: CircuitBreaker = {
  failures: 0,
  lastFailureTime: null,
  isOpen: false,
};

/** Reset circuit breaker (useful for testing). */
export function resetCircuitBreaker(): void {
  circuitBreaker.failures = 0;
  circuitBreaker.lastFailureTime = null;
  circuitBreaker.isOpen = false;
  logger.debug('Circuit breaker reset');
}

/** Get current circuit breaker state. */
export function getCircuitBreakerState(): Readonly<CircuitBreaker> {
  return { ...circuitBreaker };
}

/** Check if circuit breaker allows operation. */
function isCircuitBreakerClosed(config: AutoCompactConfig): boolean {
  if (!circuitBreaker.isOpen) return true;

  // Half-open after 5 minutes
  if (circuitBreaker.lastFailureTime && Date.now() - circuitBreaker.lastFailureTime > 5 * 60 * 1000) {
    logger.info('Circuit breaker entering half-open state');
    circuitBreaker.isOpen = false;
    circuitBreaker.failures = 0;
    return true;
  }

  return false;
}

/** Record a failure and potentially open circuit breaker. */
function recordFailure(config: AutoCompactConfig): void {
  circuitBreaker.failures++;
  circuitBreaker.lastFailureTime = Date.now();

  if (circuitBreaker.failures >= config.maxFailures) {
    circuitBreaker.isOpen = true;
    logger.warn({ failures: circuitBreaker.failures }, 'Circuit breaker OPENED');
  } else {
    logger.warn({ failures: circuitBreaker.failures }, 'Auto-compact failure recorded');
  }
}

/** Record a success and reset circuit breaker. */
function recordSuccess(): void {
  if (circuitBreaker.failures > 0) {
    logger.info({ previousFailures: circuitBreaker.failures }, 'Circuit breaker reset after success');
  }
  circuitBreaker.failures = 0;
  circuitBreaker.lastFailureTime = null;
  circuitBreaker.isOpen = false;
}

/** Check if auto-compact should be triggered. */
export function shouldAutoCompact(usedTokens: number, maxTokens: number, config?: Partial<AutoCompactConfig>): boolean {
  const cfg = { ...DEFAULT_AUTO_COMPACT_CONFIG, ...config };

  if (!isCircuitBreakerClosed(cfg)) {
    logger.debug('Auto-compact skipped: circuit breaker open');
    return false;
  }

  const pct = usedTokens / maxTokens;
  return pct > cfg.thresholdPct;
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
    openrouter: 'openrouter/quasar-alpha',
    ollama: 'llama3.2',
  };
  return map[provider] ?? 'gpt-4.1-nano';
}

/** Extract critical context from messages (decisions, errors, goals). */
function extractCriticalContext(messages: VisionMessage[]): {
  decisions: string[];
  errors: string[];
  goals: string[];
  files: string[];
} {
  const decisions: string[] = [];
  const errors: string[] = [];
  const goals: string[] = [];
  const files: string[] = [];

  for (const msg of messages) {
    for (const part of msg.content || []) {
      if (!('text' in part)) continue;
      const text = part.text.toLowerCase();

      // Look for decisions
      if (text.includes('decided') || text.includes('decision') || text.includes('choose')) {
        const sentence = part.text
          .split(/[.!?]/)
          .find((s) => s.toLowerCase().includes('decid') || s.toLowerCase().includes('choose'));
        if (sentence && !decisions.includes(sentence.trim())) {
          decisions.push(sentence.trim());
        }
      }

      // Look for errors
      if (text.includes('error') || text.includes('fail') || text.includes('exception')) {
        const sentence = part.text
          .split(/[.!?]/)
          .find((s) => s.toLowerCase().includes('error') || s.toLowerCase().includes('fail'));
        if (sentence && !errors.includes(sentence.trim())) {
          errors.push(sentence.trim());
        }
      }

      // Look for goals/pending tasks
      if (text.includes('goal') || text.includes('task') || text.includes('need to') || text.includes('pending')) {
        const sentence = part.text
          .split(/[.!?]/)
          .find(
            (s) =>
              s.toLowerCase().includes('goal') ||
              s.toLowerCase().includes('task') ||
              s.toLowerCase().includes('pending')
          );
        if (sentence && !goals.includes(sentence.trim())) {
          goals.push(sentence.trim());
        }
      }

      // Look for file references
      const fileMatches =
        part.text.match(/[\/]([\w\-]+\/[\w\-\/]+\.[\w]+)/g) || part.text.match(/([\w\-]+\/[\w\-\/]+\.[\w]+)/g);
      if (fileMatches) {
        for (const match of fileMatches) {
          const clean = match.replace(/^[\/`'"]+|[\/`'"]+$/g, '');
          if (!files.includes(clean)) {
            files.push(clean);
          }
        }
      }
    }
  }

  return {
    decisions: decisions.slice(0, 5),
    errors: errors.slice(0, 5),
    goals: goals.slice(0, 5),
    files: files.slice(0, 10),
  };
}

export type AutoCompactResult = {
  compacted: boolean;
  summary?: string;
  removedCount: number;
  tokensBefore: number;
  tokensAfter: number;
  fileReferences: string[];
  circuitBreakerOpen: boolean;
  error?: string;
};

/**
 * Perform auto-compaction via LLM summarization.
 *
 * Strategy:
 * 1. Check circuit breaker
 * 2. Select messages to summarize (middle section)
 * 3. Call cheap LLM for summary
 * 4. Replace summarized messages with summary
 * 5. Re-inject critical file references
 * 6. Update circuit breaker based on success/failure
 */
export async function autoCompact(
  history: VisionMessage[],
  usedTokens: number,
  maxTokens: number,
  provider: ProviderId,
  taskId: string,
  config?: Partial<AutoCompactConfig>
): Promise<AutoCompactResult> {
  const cfg = { ...DEFAULT_AUTO_COMPACT_CONFIG, ...config };

  // Check if we should compact
  if (!shouldAutoCompact(usedTokens, maxTokens, cfg)) {
    return {
      compacted: false,
      removedCount: 0,
      tokensBefore: usedTokens,
      tokensAfter: usedTokens,
      fileReferences: [],
      circuitBreakerOpen: circuitBreaker.isOpen,
    };
  }

  // Need enough messages to compact
  if (history.length <= cfg.preserveRecent + 2) {
    return {
      compacted: false,
      removedCount: 0,
      tokensBefore: usedTokens,
      tokensAfter: usedTokens,
      fileReferences: [],
      circuitBreakerOpen: circuitBreaker.isOpen,
      reason: 'History too short for auto-compact',
    } as AutoCompactResult;
  }

  // Check for existing summary to avoid re-summarizing
  const hasExistingSummary = history.some((m) =>
    m.content?.some((c) => 'text' in c && c.text.includes('[HISTORY SUMMARY]'))
  );

  if (hasExistingSummary) {
    logger.debug('Skipping auto-compact: history already has summary');
    return {
      compacted: false,
      removedCount: 0,
      tokensBefore: usedTokens,
      tokensAfter: usedTokens,
      fileReferences: [],
      circuitBreakerOpen: circuitBreaker.isOpen,
      reason: 'History already summarized',
    } as AutoCompactResult;
  }

  // Select range to summarize: keep system (0) + last preserveRecent
  const summarizeStart = 1;
  const summarizeEnd = history.length - cfg.preserveRecent;

  if (summarizeEnd <= summarizeStart) {
    return {
      compacted: false,
      removedCount: 0,
      tokensBefore: usedTokens,
      tokensAfter: usedTokens,
      fileReferences: [],
      circuitBreakerOpen: circuitBreaker.isOpen,
      reason: 'Not enough messages between system and recent',
    } as AutoCompactResult;
  }

  const messagesToSummarize = history.slice(summarizeStart, summarizeEnd);
  const critical = extractCriticalContext(messagesToSummarize);

  // Build summarization prompt
  const textToSummarize = messagesToSummarize
    .map((m) =>
      m.content
        ?.filter((c): c is { type: 'input_text' | 'output_text'; text: string } => 'text' in c)
        .map((c) => `${m.role}: ${c.text}`)
        .join('\n')
    )
    .filter(Boolean)
    .join('\n\n');

  const prompt = `Summarize this agent conversation history concisely.

CRITICAL CONTEXT TO PRESERVE:
${critical.decisions.length > 0 ? `Decisions made:\n${critical.decisions.map((d) => `- ${d}`).join('\n')}` : 'No key decisions recorded'}
${critical.errors.length > 0 ? `\nErrors encountered:\n${critical.errors.map((e) => `- ${e}`).join('\n')}` : ''}
${critical.goals.length > 0 ? `\nPending goals:\n${critical.goals.map((g) => `- ${g}`).join('\n')}` : ''}
${critical.files.length > 0 ? `\nFiles being worked on:\n${critical.files.map((f) => `- ${f}`).join('\n')}` : ''}

CONVERSATION TO SUMMARIZE:
${textToSummarize.slice(0, 10000)}

Provide a concise summary under 300 words. Focus on: decisions, current state, errors, and next steps.`;

  try {
    logger.info(
      {
        taskId,
        messagesToSummarize: messagesToSummarize.length,
        provider,
      },
      'Starting auto-compact summarization'
    );

    // Lazy import to avoid loading vision stack unnecessarily
    const { callVision } = await import('../vision-dispatch');

    const model = getSummarizationModel(provider);

    // Call LLM with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Auto-compact timeout')), cfg.timeoutMs);
    });

    const resultPromise = callVision(
      provider,
      prompt,
      [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      taskId,
      model
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);

    // Calculate token savings (rough estimate)
    const removedTokens = Math.floor(textToSummarize.length / 4);
    const summaryTokens = Math.floor(result.text.length / 4);
    const tokensAfter = usedTokens - removedTokens + summaryTokens;

    // Replace summarized messages with summary
    const summaryMessage: VisionMessage = {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: `[HISTORY SUMMARY - Auto-compacted]\n${result.text}\n[/HISTORY SUMMARY]`,
        },
      ],
    };

    history.splice(summarizeStart, messagesToSummarize.length, summaryMessage);

    // Record success
    recordSuccess();

    logger.info(
      {
        taskId,
        removedCount: messagesToSummarize.length,
        tokensSaved: removedTokens - summaryTokens,
        circuitBreakerStatus: 'closed',
      },
      'Auto-compact successful'
    );

    return {
      compacted: true,
      summary: result.text,
      removedCount: messagesToSummarize.length,
      tokensBefore: usedTokens,
      tokensAfter,
      fileReferences: critical.files,
      circuitBreakerOpen: false,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    recordFailure(cfg);

    logger.error(
      {
        taskId,
        error: errorMsg,
        failures: circuitBreaker.failures,
        circuitBreakerOpen: circuitBreaker.isOpen,
      },
      'Auto-compact failed'
    );

    return {
      compacted: false,
      removedCount: 0,
      tokensBefore: usedTokens,
      tokensAfter: usedTokens,
      fileReferences: critical.files,
      circuitBreakerOpen: circuitBreaker.isOpen,
      error: errorMsg,
    };
  }
}

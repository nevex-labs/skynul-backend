/**
 * Snip Compaction — remove oldest messages when context exceeds threshold.
 *
 * Priority preservation order:
 * 1. System prompt (first message)
 * 2. History summary (if exists)
 * 3. Recent N messages (configurable)
 * 4. Critical tool results with file references
 *
 * Fast operation, no API calls.
 */

import type { VisionMessage } from '../../../types';

export type SnipConfig = {
  /** Max context percentage before snipping starts (default: 0.80) */
  thresholdPct: number;
  /** Target context percentage after snipping (default: 0.60) */
  targetPct: number;
  /** Number of recent messages to always preserve (default: 6) */
  preserveRecent: number;
  /** Max tokens to consider for snipping calculation */
  maxTokens: number;
};

export const DEFAULT_SNIP_CONFIG: SnipConfig = {
  thresholdPct: 0.8,
  targetPct: 0.6,
  preserveRecent: 6,
  maxTokens: 200_000,
};

/** Check if snipping is needed based on current token usage. */
export function shouldSnip(usedTokens: number, maxTokens: number, config?: Partial<SnipConfig>): boolean {
  const threshold = config?.thresholdPct ?? DEFAULT_SNIP_CONFIG.thresholdPct;
  const pct = usedTokens / maxTokens;
  return pct > threshold;
}

/** Find the index of the last history summary message. */
function findSummaryIndex(history: VisionMessage[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const hasSummary = msg.content?.some(
      (c): c is { type: 'input_text'; text: string } => 'text' in c && c.text.includes('[HISTORY SUMMARY]')
    );
    if (hasSummary) return i;
  }
  return -1;
}

/** Extract file references from a message (paths mentioned in text). */
function extractFileReferences(text: string): string[] {
  // Match common file path patterns
  const patterns = [
    /(?:^|\s|\()([\w\-]+\/[\w\-\/]+\.[\w]+)/g, // path/to/file.ext (with boundary)
    /`([^`]+\.[\w]+)`/g, // `file.ext`
  ];

  const refs: string[] = [];
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const path = match[1];
      if (path && !refs.includes(path)) {
        refs.push(path);
      }
    }
  }
  return refs;
}

/** Collect file references from messages that will be snipped. */
function collectFileReferencesToPreserve(history: VisionMessage[], startIndex: number, endIndex: number): string[] {
  const refs: string[] = [];

  for (let i = startIndex; i <= endIndex && i < history.length; i++) {
    const msg = history[i];
    for (const part of msg.content || []) {
      if ('text' in part) {
        const found = extractFileReferences(part.text);
        for (const ref of found) {
          if (!refs.includes(ref)) {
            refs.push(ref);
          }
        }
      }
    }
  }

  return refs;
}

/** Estimate tokens for a single message. */
function estimateMessageTokens(msg: VisionMessage): number {
  let chars = 0;
  for (const part of msg.content || []) {
    if ('text' in part) {
      chars += part.text.length;
    } else if ('image_url' in part) {
      // Images are expensive (~800 tokens for auto detail)
      chars += 3200; // 800 tokens * 4 chars/token
    }
  }
  return Math.ceil(chars / 4);
}

/** Calculate current token usage from history. */
export function calculateHistoryTokens(history: VisionMessage[]): number {
  return history.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

export type SnipResult = {
  /** Whether any snipping occurred */
  snipped: boolean;
  /** Number of messages removed */
  removedCount: number;
  /** Messages that were preserved (for logging/debugging) */
  preservedMessages: number;
  /** File references found in snipped content (for re-injection) */
  fileReferences: string[];
  /** Token usage before snipping */
  tokensBefore: number;
  /** Token usage after snipping */
  tokensAfter: number;
  /** Reason for snipping or not */
  reason: string;
};

/**
 * Perform snip compaction on history.
 *
 * Strategy:
 * 1. Always preserve system prompt (index 0)
 * 2. Preserve history summary if exists
 * 3. Preserve last N messages
 * 4. Everything in between is candidate for removal
 * 5. Collect file references from removed messages
 */
export function snipHistory(
  history: VisionMessage[],
  usedTokens: number,
  maxTokens: number,
  config?: Partial<SnipConfig>
): SnipResult {
  const cfg = { ...DEFAULT_SNIP_CONFIG, ...config };
  const tokensBefore = usedTokens;

  // Check if snipping is needed
  if (!shouldSnip(usedTokens, maxTokens, cfg)) {
    return {
      snipped: false,
      removedCount: 0,
      preservedMessages: history.length,
      fileReferences: [],
      tokensBefore,
      tokensAfter: tokensBefore,
      reason: `Context at ${((usedTokens / maxTokens) * 100).toFixed(1)}% below threshold ${(cfg.thresholdPct * 100).toFixed(0)}%`,
    };
  }

  if (history.length <= cfg.preserveRecent + 1) {
    return {
      snipped: false,
      removedCount: 0,
      preservedMessages: history.length,
      fileReferences: [],
      tokensBefore,
      tokensAfter: tokensBefore,
      reason: 'History too short to snip',
    };
  }

  // Calculate target token count
  const targetTokens = Math.floor(maxTokens * cfg.targetPct);

  // Find summary index if exists
  const summaryIndex = findSummaryIndex(history);

  // Determine which messages to preserve
  // Always: index 0 (system), last preserveRecent messages
  // Also: summary message if exists
  const preserveSet = new Set<number>();
  preserveSet.add(0); // System prompt

  // Add last N messages
  for (let i = Math.max(1, history.length - cfg.preserveRecent); i < history.length; i++) {
    preserveSet.add(i);
  }

  // Add summary if exists and not already included
  if (summaryIndex >= 0 && !preserveSet.has(summaryIndex)) {
    preserveSet.add(summaryIndex);
  }

  // Find snippable range (between preserved messages)
  const sortedPreserve = Array.from(preserveSet).sort((a, b) => a - b);
  let snipStart = -1;
  let snipEnd = -1;

  // Find the largest gap between preserved messages
  for (let i = 0; i < sortedPreserve.length - 1; i++) {
    const gapStart = sortedPreserve[i] + 1;
    const gapEnd = sortedPreserve[i + 1] - 1;
    if (gapEnd >= gapStart && snipEnd - snipStart < gapEnd - gapStart) {
      snipStart = gapStart;
      snipEnd = gapEnd;
    }
  }

  if (snipStart < 0 || snipEnd < snipStart) {
    return {
      snipped: false,
      removedCount: 0,
      preservedMessages: history.length,
      fileReferences: [],
      tokensBefore,
      tokensAfter: tokensBefore,
      reason: 'No snippable range found',
    };
  }

  // Collect file references before removing
  const fileReferences = collectFileReferencesToPreserve(history, snipStart, snipEnd);

  // Calculate tokens being removed
  let removedTokens = 0;
  for (let i = snipStart; i <= snipEnd; i++) {
    removedTokens += estimateMessageTokens(history[i]);
  }

  // Remove messages
  const removedCount = snipEnd - snipStart + 1;
  history.splice(snipStart, removedCount);

  const tokensAfter = tokensBefore - removedTokens;

  return {
    snipped: true,
    removedCount,
    preservedMessages: history.length,
    fileReferences,
    tokensBefore,
    tokensAfter,
    reason: `Snipped ${removedCount} messages (${removedTokens} tokens) to reach ${((tokensAfter / maxTokens) * 100).toFixed(1)}%`,
  };
}

/**
 * Create a re-injection message with file references from snipped content.
 * Returns undefined if no references to preserve.
 */
export function createReinjectionMessage(fileReferences: string[]): VisionMessage | undefined {
  if (fileReferences.length === 0) return undefined;

  const refs = fileReferences.slice(0, 10); // Limit to 10 refs
  const text = `[PRESERVED CONTEXT]\nFiles referenced in removed conversation:\n${refs.map((r) => `- ${r}`).join('\n')}\n[/PRESERVED CONTEXT]`;

  return {
    role: 'user',
    content: [{ type: 'input_text', text }],
  };
}

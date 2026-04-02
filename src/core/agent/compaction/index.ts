/**
 * Layered Compaction System
 *
 * Four-layer approach to managing context window growth:
 *
 * Layer 1: Tool Result Budgeting
 * - Persist large tool results to disk
 * - Show preview + file path in context
 *
 * Layer 2: Snip Compaction
 * - Remove oldest messages when context > 80%
 * - Preserve: system prompt + summary + recent N messages
 * - Fast, no API calls
 *
 * Layer 3: Auto-Compact
 * - LLM-driven summarization when > 95%
 * - Circuit breaker prevents infinite loops
 * - Re-injects critical file references
 *
 * Layer 4: Reactive 413 Recovery
 * - Handle "Prompt Too Long" errors
 * - Progressive: snip → compact → model fallback
 * - Never fails silently
 */

export {
  // Snip Compaction
  snipHistory,
  shouldSnip,
  calculateHistoryTokens,
  createReinjectionMessage,
  DEFAULT_SNIP_CONFIG,
  type SnipConfig,
  type SnipResult,
} from './snip-compaction';

export {
  // Auto-Compact
  autoCompact,
  shouldAutoCompact,
  getSummarizationModel,
  resetCircuitBreaker,
  getCircuitBreakerState,
  DEFAULT_AUTO_COMPACT_CONFIG,
  type AutoCompactConfig,
  type AutoCompactResult,
} from './auto-compact';

export {
  // Reactive Recovery
  attemptRecovery,
  isContextLengthError,
  formatRecoveryReport,
  DEFAULT_RECOVERY_CONFIG,
  type RecoveryConfig,
  type RecoveryResult,
  type RecoveryAttempt,
} from './reactive-recovery';

export {
  // Tool Result Budgeting
  applyBudget,
  exceedsBudget,
  resolveLimit,
  persistResult,
  cleanupPersistedResults,
  DEFAULT_TOOL_BUDGET_CONFIG,
  DEFAULT_MAX_RESULT_CHARS,
  ACTION_LIMITS,
  type ToolBudgetConfig,
  type BudgetApplyResult,
  type CleanupResult,
} from './tool-result-budget';

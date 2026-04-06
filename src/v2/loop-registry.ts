/**
 * Loop Registry
 *
 * Maps task mode to a setup function that returns:
 * - actionExecutors: registry of action handlers
 * - systemPrompt: prompt for the LLM
 * - initialHistory: starting messages for the conversation
 * - cleanup?: optional cleanup function (e.g., close browser)
 * - formatObservation?: custom formatter for action results
 */

import type { Task, TaskAction } from './task-runner';

// ── Types ──────────────────────────────────────────────────────────────

export type LoopSetupResult = {
  /** Registry of action handlers for this mode */
  actionExecutors: Record<string, (action: TaskAction) => Promise<string | undefined>>;

  /** System prompt for the LLM */
  systemPrompt: string;

  /** Initial conversation history */
  initialHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;

  /** Optional: cleanup function called when task ends */
  cleanup?(): Promise<void>;

  /** Optional: custom formatter for action results (e.g., append browser snapshot) */
  formatObservation?(action: TaskAction, result: string | undefined, error?: string): Promise<string> | string;
};

export type LoopSetupFn = (task: Task) => Promise<LoopSetupResult> | LoopSetupResult;

export type LoopRegistry = {
  register(mode: string, setup: LoopSetupFn): void;
  get(mode: string): LoopSetupFn | undefined;
  modes(): string[];
};

// ── Default Registry ───────────────────────────────────────────────────

export function createLoopRegistry(): LoopRegistry {
  const registry = new Map<string, LoopSetupFn>();

  return {
    register(mode, setup) {
      registry.set(mode, setup);
    },
    get(mode) {
      return registry.get(mode);
    },
    modes() {
      return Array.from(registry.keys());
    },
  };
}

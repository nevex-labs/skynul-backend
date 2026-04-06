/**
 * Layer 4: Task Runner
 *
 * Thin orchestrator that receives a task with a resolved provider
 * and delegates to the correct execution loop based on the task's mode.
 *
 * Self-contained — only depends on Layer 2 (types) and Layer 3 (agent loop).
 */

import { type LoopCallbacks, type LoopOpts, type LoopResult, runAgentLoop } from './agent-loop';
import type { ProviderId } from './provider-dispatch';

// ── Types ──────────────────────────────────────────────────────────────

export type TaskMode = 'browser' | 'code' | 'cdp' | 'orchestrator';

export type TaskAction = {
  type: string;
  [key: string]: unknown;
};

export type TaskStep = {
  index: number;
  timestamp: number;
  action: TaskAction;
  thought?: string;
  result?: string;
  error?: string;
};

export type TaskUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type Task = {
  id: string;
  prompt: string;
  mode: TaskMode;
  capabilities: string[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  steps: TaskStep[];
  error?: string;
  summary?: string;
  usage?: TaskUsage;
  userId?: number;
  attachments?: string[];
  createdAt: number;
  updatedAt: number;
};

export type TaskRunnerCallbacks = {
  /** Called when the task state changes */
  onUpdate(task: Task): void;
};

export type TaskRunnerOpts = {
  /** Task to execute */
  task: Task;

  /** Resolved provider (from Layer 1) */
  provider: ProviderId;

  /** Function to call the LLM (injected from Layer 2) */
  callLLM: (messages: { role: string; content: string }[]) => Promise<string>;

  /** Callbacks for status updates */
  callbacks: TaskRunnerCallbacks;

  /** System prompt from loop setup (overrides built-in) */
  systemPrompt?: string;

  /** Initial history from loop setup (overrides default) */
  initialHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;

  /** Allowed tools from agent definition */
  agentAllowedTools?: string[];

  /** Maximum number of steps before forcing termination */
  maxSteps?: number;

  /** Optional context window in tokens */
  contextWindow?: number;

  /** Action executor registry — maps action types to execution functions */
  actionExecutors: Record<string, (action: TaskAction) => Promise<string | undefined>>;

  /** Optional: custom formatter for action results (from loop setup) */
  formatObservation?: (action: TaskAction, result: string | undefined, error?: string) => Promise<string> | string;

  /** Optional: cleanup function called when task ends (from loop setup) */
  cleanup?(): Promise<void>;
};

// ── System Prompt Builder ──────────────────────────────────────────────

/**
 * Build the system prompt for a task.
 * Injects context from memory, capabilities, and agent definition.
 */
export function buildSystemPrompt(opts: {
  task: Task;
  memoryContext?: string;
  agentSystemPrompt?: string;
}): string {
  const parts: string[] = [];

  // Agent definition (if provided)
  if (opts.agentSystemPrompt) {
    parts.push(opts.agentSystemPrompt);
  }

  // Default behavior
  if (!opts.agentSystemPrompt) {
    parts.push(
      `You are an autonomous agent. Execute the user's task step by step.\n` +
        `Respond with JSON: {"thought": "...", "action": {"type": "...", ...}}\n` +
        `When done: {"action": {"type": "done", "summary": "..."}}\n` +
        `When failing: {"action": {"type": "fail", "reason": "..."}}`
    );
  }

  // Capabilities
  if (opts.task.capabilities.length > 0) {
    parts.push(`\nAvailable capabilities: ${opts.task.capabilities.join(', ')}`);
  }

  // Memory context or any other injected context
  if (opts.memoryContext) {
    parts.push(`\nContext:\n${opts.memoryContext}`);
  }

  return parts.join('\n');
}

// ── Action Executor Registry ───────────────────────────────────────────

/**
 * Create an action executor that delegates to the registered handlers.
 * Falls back to a generic "action not supported" message for unknown types.
 */
export function createActionDispatcher(
  executors: Record<string, (action: TaskAction) => Promise<string | undefined>>
): (action: TaskAction) => Promise<string | undefined> {
  return async (action: TaskAction): Promise<string | undefined> => {
    const handler = executors[action.type];
    if (!handler) {
      return `Action "${action.type}" is not registered. Available: ${Object.keys(executors).join(', ')}`;
    }
    return handler(action);
  };
}

// ── Task Runner ────────────────────────────────────────────────────────

/**
 * Execute a task by delegating to the agent loop.
 *
 * Flow:
 * 1. Build system prompt
 * 2. Initialize history with user message
 * 3. Create action dispatcher
 * 4. Run agent loop
 * 5. Update task with results
 */
export async function runTask(opts: TaskRunnerOpts): Promise<Task> {
  const { task, provider, callLLM, callbacks, actionExecutors } = opts;

  // Update task status
  task.status = 'running';
  task.updatedAt = Date.now();
  callbacks.onUpdate(task);

  // Use system prompt from loop setup, or build default
  const systemPrompt = opts.systemPrompt ?? buildSystemPrompt({ task });

  // Use history from loop setup, or initialize with user message
  const history = opts.initialHistory
    ? opts.initialHistory.map((m) => ({ role: m.role, content: m.content }))
    : [{ role: 'user' as const, content: task.prompt }];

  // Create action dispatcher (wrapped with formatObservation if provided)
  const rawDispatcher = createActionDispatcher(actionExecutors);
  const executeAction = opts.formatObservation
    ? async (action: TaskAction): Promise<string | undefined> => {
        let result: string | undefined;
        let error: string | undefined;
        try {
          result = await rawDispatcher(action);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
        return opts.formatObservation!(action, result, error);
      }
    : rawDispatcher;

  // Run agent loop
  const result = await runAgentLoop({
    systemPrompt,
    history,
    provider,
    callLLM,
    maxSteps: opts.maxSteps ?? 50,
    contextWindow: opts.contextWindow,
    taskId: task.id,
    callbacks: {
      executeAction,
      isAborted: () => task.status === 'cancelled',
      pushStatus: (msg) => {
        // Could broadcast via WebSocket here
      },
      recordStep: (step) => {
        task.steps.push(step as TaskStep);
        task.updatedAt = Date.now();
        callbacks.onUpdate(task);
      },
      allowedTools: opts.agentAllowedTools,
    },
  });

  // Update task with results
  task.status = mapStatus(result.status);
  task.summary = result.summary;
  task.error = result.error;
  task.updatedAt = Date.now();
  callbacks.onUpdate(task);

  // Cleanup loop resources (e.g., close browser)
  if (opts.cleanup) {
    try {
      await opts.cleanup();
    } catch (err) {
      // Log but don't fail — task already completed
    }
  }

  return task;
}

function mapStatus(status: LoopResult['status']): Task['status'] {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'max_steps':
      return 'failed';
  }
}

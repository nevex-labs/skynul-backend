/**
 * Turn-level timing and token tracking for agent loop performance analysis.
 */

export type TurnMetrics = {
  stepIndex: number;
  visionMs: number;
  parseMs: number;
  executeMs: number;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  actionType: string;
  error?: string;
};

export type TaskMetrics = {
  taskId: string;
  totalTurns: number;
  totalMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  turns: TurnMetrics[];
  toolCounts: Record<string, number>;
  errorCount: number;
  startedAt: number;
  endedAt?: number;
};

export type ToolStats = {
  count: number;
  totalMs: number;
  errors: number;
  durations: number[];
};

export class TurnTimer {
  private turnStart = 0;
  private visionStart = 0;
  private parseStart = 0;
  private executeStart = 0;

  private visionMs = 0;
  private parseMs = 0;
  private executeMs = 0;

  beginTurn(): void {
    this.turnStart = Date.now();
  }

  startVision(): void {
    this.visionStart = Date.now();
  }

  endVision(): void {
    this.visionMs = Date.now() - this.visionStart;
  }

  startParse(): void {
    this.parseStart = Date.now();
  }

  endParse(): void {
    this.parseMs = Date.now() - this.parseStart;
  }

  startExecute(): void {
    this.executeStart = Date.now();
  }

  endExecute(): void {
    this.executeMs = Date.now() - this.executeStart;
  }

  finish(
    stepIndex: number,
    actionType: string,
    usage?: { inputTokens: number; outputTokens: number },
    error?: string
  ): TurnMetrics {
    return {
      stepIndex,
      visionMs: this.visionMs,
      parseMs: this.parseMs,
      executeMs: this.executeMs,
      totalMs: Date.now() - this.turnStart,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      actionType,
      error,
    };
  }
}

export class TaskMetricsCollector {
  private metrics: TaskMetrics;
  private toolStats = new Map<string, ToolStats>();

  constructor(taskId: string) {
    this.metrics = {
      taskId,
      totalTurns: 0,
      totalMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      turns: [],
      toolCounts: {},
      errorCount: 0,
      startedAt: Date.now(),
    };
  }

  recordTurn(turn: TurnMetrics): void {
    this.metrics.totalTurns++;
    this.metrics.totalMs += turn.totalMs;
    this.metrics.totalInputTokens += turn.inputTokens;
    this.metrics.totalOutputTokens += turn.outputTokens;
    this.metrics.turns.push(turn);

    this.metrics.toolCounts[turn.actionType] = (this.metrics.toolCounts[turn.actionType] ?? 0) + 1;

    if (turn.error) {
      this.metrics.errorCount++;
    }

    // Tool stats
    const existing = this.toolStats.get(turn.actionType) ?? { count: 0, totalMs: 0, errors: 0, durations: [] };
    existing.count++;
    existing.totalMs += turn.executeMs;
    existing.durations.push(turn.executeMs);
    if (turn.error) existing.errors++;
    this.toolStats.set(turn.actionType, existing);
  }

  finish(model = 'gpt-4o'): TaskMetrics {
    this.metrics.endedAt = Date.now();
    this.metrics.estimatedCostUsd = estimateCost(model, this.metrics.totalInputTokens, this.metrics.totalOutputTokens);
    return { ...this.metrics };
  }

  getMetrics(): TaskMetrics {
    return { ...this.metrics };
  }

  /** Get stats for a specific tool type. */
  getToolStats(actionType: string): ToolStats | undefined {
    return this.toolStats.get(actionType);
  }

  /** Get sorted percentile from durations array. */
  static percentile(durations: number[], pct: number): number {
    if (durations.length === 0) return 0;
    const sorted = [...durations].sort((a, b) => a - b);
    const idx = Math.ceil((pct / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
  }
}

// ── Global tool stats aggregation ───────────────────────────────────────────

const globalToolStats = new Map<string, ToolStats>();

/** Record a tool execution globally (used by all tasks). */
export function recordGlobalToolExecution(actionType: string, durationMs: number, error?: string): void {
  const existing = globalToolStats.get(actionType) ?? { count: 0, totalMs: 0, errors: 0, durations: [] };
  existing.count++;
  existing.totalMs += durationMs;
  existing.durations.push(durationMs);
  if (error) existing.errors++;
  globalToolStats.set(actionType, existing);
}

/** Get global stats for a tool type. */
export function getGlobalToolStats(actionType: string): ToolStats | undefined {
  return globalToolStats.get(actionType);
}

/** Get all global tool stats. */
export function getAllGlobalToolStats(): Record<string, ToolStats> {
  return Object.fromEntries(globalToolStats);
}

// ── Cost tracking (USD estimates) ───────────────────────────────────────────

// Rough cost per 1K tokens (updated 2024)
const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const cost = COST_PER_1K_TOKENS[model] ?? COST_PER_1K_TOKENS['gpt-4o'];
  return (inputTokens / 1000) * cost.input + (outputTokens / 1000) * cost.output;
}

// ── Global metrics store ────────────────────────────────────────────────────

const taskMetricsStore = new Map<string, TaskMetrics>();

/** Store metrics for a task (called when task finishes). */
export function storeTaskMetrics(metrics: TaskMetrics): void {
  taskMetricsStore.set(metrics.taskId, metrics);

  // Also record to global tool stats
  for (const turn of metrics.turns) {
    recordGlobalToolExecution(turn.actionType, turn.executeMs, turn.error);
  }
}

/** Get metrics for a specific task. */
export function getTaskMetrics(taskId: string): TaskMetrics | undefined {
  return taskMetricsStore.get(taskId);
}

/** Get all stored metrics (most recent first). */
export function getAllTaskMetrics(): TaskMetrics[] {
  return [...taskMetricsStore.values()].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
}

/** Get global overview metrics. */
export function getMetricsOverview(): {
  totalTasks: number;
  totalTurns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  toolStats: Record<string, ToolStats>;
} {
  const all = getAllTaskMetrics();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  for (const m of all) {
    totalInputTokens += m.totalInputTokens;
    totalOutputTokens += m.totalOutputTokens;
    // Use first turn's model for cost estimate (simplified)
    const model = m.turns[0] ? 'gpt-4o' : 'gpt-4o';
    totalCostUsd += estimateCost(model, m.totalInputTokens, m.totalOutputTokens);
  }

  return {
    totalTasks: all.length,
    totalTurns: all.reduce((sum, m) => sum + m.totalTurns, 0),
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    toolStats: getAllGlobalToolStats(),
  };
}

/** Clear stored metrics. */
export function clearMetrics(): void {
  taskMetricsStore.clear();
  globalToolStats.clear();
}

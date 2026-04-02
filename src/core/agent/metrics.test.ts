import { beforeEach, describe, expect, it } from 'vitest';
import {
  TaskMetricsCollector,
  TurnTimer,
  clearMetrics,
  getAllGlobalToolStats,
  getAllTaskMetrics,
  getGlobalToolStats,
  getMetricsOverview,
  getTaskMetrics,
  recordGlobalToolExecution,
  storeTaskMetrics,
} from './metrics';

describe('TurnTimer', () => {
  it('measures all phases', () => {
    const timer = new TurnTimer();

    timer.beginTurn();
    timer.startVision();
    // simulate 10ms
    timer.endVision();
    timer.startParse();
    timer.endParse();
    timer.startExecute();
    timer.endExecute();

    const result = timer.finish(0, 'file_read');

    expect(result.stepIndex).toBe(0);
    expect(result.actionType).toBe('file_read');
    expect(result.visionMs).toBeGreaterThanOrEqual(0);
    expect(result.parseMs).toBeGreaterThanOrEqual(0);
    expect(result.executeMs).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('includes usage and error', () => {
    const timer = new TurnTimer();
    timer.beginTurn();

    const result = timer.finish(1, 'shell', { inputTokens: 100, outputTokens: 50 }, 'Permission denied');

    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.error).toBe('Permission denied');
  });
});

describe('TaskMetricsCollector', () => {
  it('aggregates multiple turns', () => {
    const collector = new TaskMetricsCollector('task-123');

    collector.recordTurn({
      stepIndex: 0,
      visionMs: 100,
      parseMs: 10,
      executeMs: 50,
      totalMs: 160,
      inputTokens: 1000,
      outputTokens: 500,
      actionType: 'file_read',
    });

    collector.recordTurn({
      stepIndex: 1,
      visionMs: 120,
      parseMs: 15,
      executeMs: 60,
      totalMs: 195,
      inputTokens: 1200,
      outputTokens: 600,
      actionType: 'shell',
      error: 'Failed',
    });

    const metrics = collector.finish();

    expect(metrics.totalTurns).toBe(2);
    expect(metrics.totalMs).toBe(355);
    expect(metrics.totalInputTokens).toBe(2200);
    expect(metrics.totalOutputTokens).toBe(1100);
    expect(metrics.toolCounts).toEqual({ file_read: 1, shell: 1 });
    expect(metrics.errorCount).toBe(1);
    expect(metrics.endedAt).toBeDefined();
  });

  it('calculates tool stats percentiles', () => {
    const collector = new TaskMetricsCollector('task-456');

    for (let i = 0; i < 10; i++) {
      collector.recordTurn({
        stepIndex: i,
        visionMs: 100,
        parseMs: 10,
        executeMs: i * 10,
        totalMs: 100,
        inputTokens: 0,
        outputTokens: 0,
        actionType: 'file_read',
      });
    }

    const stats = collector.getToolStats('file_read');
    expect(stats?.count).toBe(10);
    expect(TaskMetricsCollector.percentile(stats!.durations, 50)).toBe(40);
    expect(TaskMetricsCollector.percentile(stats!.durations, 95)).toBe(90);
  });
});

describe('Global metrics store', () => {
  beforeEach(() => {
    clearMetrics();
  });

  it('stores and retrieves metrics', () => {
    const metrics = {
      taskId: 'task-789',
      totalTurns: 1,
      totalMs: 100,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      estimatedCostUsd: 0.0003,
      turns: [],
      toolCounts: {},
      errorCount: 0,
      startedAt: Date.now(),
      endedAt: Date.now(),
    };

    storeTaskMetrics(metrics);

    expect(getTaskMetrics('task-789')).toEqual(metrics);
  });

  it('returns all metrics sorted by end time', () => {
    storeTaskMetrics({
      taskId: 'old',
      totalTurns: 1,
      totalMs: 100,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      turns: [],
      toolCounts: {},
      errorCount: 0,
      startedAt: 1000,
      endedAt: 2000,
    });

    storeTaskMetrics({
      taskId: 'new',
      totalTurns: 1,
      totalMs: 100,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      turns: [],
      toolCounts: {},
      errorCount: 0,
      startedAt: 1000,
      endedAt: 3000,
    });

    const all = getAllTaskMetrics();
    expect(all[0].taskId).toBe('new');
    expect(all[1].taskId).toBe('old');
  });
});

describe('Global tool stats', () => {
  beforeEach(() => {
    clearMetrics();
  });

  it('records tool executions globally', () => {
    recordGlobalToolExecution('file_read', 50);
    recordGlobalToolExecution('file_read', 100);
    recordGlobalToolExecution('shell', 200, 'error');

    const fileStats = getGlobalToolStats('file_read');
    expect(fileStats?.count).toBe(2);
    expect(fileStats?.totalMs).toBe(150);

    const shellStats = getGlobalToolStats('shell');
    expect(shellStats?.count).toBe(1);
    expect(shellStats?.errors).toBe(1);
  });

  it('aggregates stats when storing task metrics', () => {
    const collector = new TaskMetricsCollector('task-1');
    collector.recordTurn({
      stepIndex: 0,
      visionMs: 100,
      parseMs: 10,
      executeMs: 50,
      totalMs: 160,
      inputTokens: 0,
      outputTokens: 0,
      actionType: 'file_read',
    });

    const metrics = collector.finish();
    storeTaskMetrics(metrics);

    const stats = getGlobalToolStats('file_read');
    expect(stats?.count).toBe(1);
    expect(stats?.totalMs).toBe(50);
  });
});

describe('Metrics overview', () => {
  beforeEach(() => {
    clearMetrics();
  });

  it('returns aggregated overview', () => {
    const collector1 = new TaskMetricsCollector('task-1');
    collector1.recordTurn({
      stepIndex: 0,
      visionMs: 100,
      parseMs: 10,
      executeMs: 50,
      totalMs: 160,
      inputTokens: 1000,
      outputTokens: 500,
      actionType: 'file_read',
    });
    storeTaskMetrics(collector1.finish());

    const collector2 = new TaskMetricsCollector('task-2');
    collector2.recordTurn({
      stepIndex: 0,
      visionMs: 100,
      parseMs: 10,
      executeMs: 50,
      totalMs: 160,
      inputTokens: 2000,
      outputTokens: 1000,
      actionType: 'shell',
    });
    storeTaskMetrics(collector2.finish());

    const overview = getMetricsOverview();
    expect(overview.totalTasks).toBe(2);
    expect(overview.totalTurns).toBe(2);
    expect(overview.totalInputTokens).toBe(3000);
    expect(overview.totalOutputTokens).toBe(1500);
    expect(overview.totalCostUsd).toBeGreaterThan(0);
    expect(overview.toolStats).toHaveProperty('file_read');
    expect(overview.toolStats).toHaveProperty('shell');
  });
});

import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseLive } from '../../../services/database';
import { TaskMemoryService } from '../../../services/task-memory';
import type { OrchestratorPlan, Task } from '../../../shared/types';
import type { ExecutorContext } from '../action-executors';
import { executeOrchestratorAction, setupOrchestratorLoop } from './orchestrator-loop';

vi.mock('../../config', () => ({ getDataDir: vi.fn(() => '/tmp') }));

// Mock runTaskMemoryEffect for tests
vi.mock('../action-executors', async () => {
  const { TaskMemoryService: TMS } = await import('../../../services/task-memory');

  const mockService = TMS.of({
    saveMemory: () => Effect.succeed(undefined),
    searchMemories: () => Effect.succeed([]),
    formatMemoriesForPrompt: () => '',
    saveFact: () => Effect.succeed(undefined),
    deleteFact: () => Effect.succeed(undefined),
    listFacts: () => Effect.succeed([]),
    searchFacts: () => Effect.succeed([]),
    formatFactsForPrompt: () => '',
    saveObservation: () => Effect.succeed(1),
    searchObservations: () => Effect.succeed([]),
    getRecentObservations: () => Effect.succeed([]),
    deleteObservation: () => Effect.succeed(undefined),
    formatObservationsForPrompt: () => '',
  });

  const mockLayer = Layer.succeed(TMS, mockService);

  return {
    runTaskMemoryEffect: async (effect: any) => {
      const program = effect.pipe(Effect.provide(mockLayer), Effect.provide(DatabaseLive));
      return Effect.runPromise(program);
    },
  };
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_test123',
    prompt: 'Plan and execute a market research task',
    status: 'running',
    mode: 'browser',
    runner: 'orchestrator',
    capabilities: [],
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    maxSteps: 50,
    timeoutMs: 30 * 60 * 1000,
    ...overrides,
  };
}

function makeCtx(task: Task, tm?: any): ExecutorContext & { pushUpdate: ReturnType<typeof vi.fn> } {
  const pushUpdate = vi.fn() as unknown as (() => void) & ReturnType<typeof vi.fn>;
  return {
    task,
    taskManager: tm ?? null,
    appBridge: {} as any,
    pushUpdate,
    pushStatus: vi.fn() as unknown as (msg: string) => void,
  };
}

describe('setupOrchestratorLoop', () => {
  it('returns system prompts, history, and callbacks', () => {
    const task = makeTask();
    const result = setupOrchestratorLoop({
      deps: { task, taskManager: null, maxSteps: 50 },
      onStatus: vi.fn(),
      onUpdate: vi.fn(),
      isAborted: () => false,
    });

    expect(result.systemPrompt).toBeDefined();
    expect(result.systemPromptCompact).toBeDefined();
    expect(result.history).toBeInstanceOf(Array);
    expect(result.callbacks).toBeDefined();
  });

  it('system prompt contains orchestrator directives', () => {
    const task = makeTask();
    const result = setupOrchestratorLoop({
      deps: { task, taskManager: null, maxSteps: 50 },
      onStatus: vi.fn(),
      onUpdate: vi.fn(),
      isAborted: () => false,
    });
    expect(result.systemPrompt).toContain('orchestrator');
    expect(result.systemPrompt).toContain('task_spawn');
    expect(result.systemPrompt).toContain('task_wait');
  });

  it('compact prompt is shorter than full prompt', () => {
    const task = makeTask();
    const result = setupOrchestratorLoop({
      deps: { task, taskManager: null, maxSteps: 50 },
      onStatus: vi.fn(),
      onUpdate: vi.fn(),
      isAborted: () => false,
    });
    expect(result.systemPromptCompact.length).toBeLessThan(result.systemPrompt.length);
  });

  it('initial history contains task prompt', () => {
    const task = makeTask({ prompt: 'Research crypto trends' });
    const result = setupOrchestratorLoop({
      deps: { task, taskManager: null, maxSteps: 50 },
      onStatus: vi.fn(),
      onUpdate: vi.fn(),
      isAborted: () => false,
    });
    const firstMsg = result.history[0];
    expect(firstMsg).toBeDefined();
    const content = firstMsg!.content;
    const text = Array.isArray(content) ? (content[0] as any).text : content;
    expect(text).toContain('Research crypto trends');
  });

  it('buildTurnMessage at step 0 returns task prompt', async () => {
    const task = makeTask({ prompt: 'Do research' });
    const result = setupOrchestratorLoop({
      deps: { task, taskManager: null, maxSteps: 50 },
      onStatus: vi.fn(),
      onUpdate: vi.fn(),
      isAborted: () => false,
    });
    const turn = await result.callbacks.buildTurnMessage(0, { applyLevel1: false });
    expect(turn.text).toContain('Do research');
    expect(turn.images).toBeUndefined(); // no screenshots in orchestrator
  });

  it('buildTurnMessage after step 0 includes child task status', async () => {
    const task = makeTask({ childTaskIds: ['task_child1'] });
    const mockTm = {
      get: vi.fn((id: string) => ({
        id,
        status: 'completed',
        summary: 'Research done',
        agentRole: 'Research',
      })),
      drainMessages: vi.fn(() => []),
    };

    const result = setupOrchestratorLoop({
      deps: { task, taskManager: mockTm as any, maxSteps: 50 },
      onStatus: vi.fn(),
      onUpdate: vi.fn(),
      isAborted: () => false,
    });
    const turn = await result.callbacks.buildTurnMessage(1, { applyLevel1: false });
    expect(turn.text).toContain('task_child1');
    expect(turn.text).toContain('completed');
    expect(turn.images).toBeUndefined();
  });

  it('includes trading cap in system prompt when capabilities include trading', () => {
    const task = makeTask({ capabilities: ['polymarket.trading'] });
    const result = setupOrchestratorLoop({
      deps: { task, taskManager: null, maxSteps: 50 },
      onStatus: vi.fn(),
      onUpdate: vi.fn(),
      isAborted: () => false,
    });
    expect(result.systemPrompt).toContain('TRADING SAFETY GATE');
  });
});

describe('executeOrchestratorAction', () => {
  let task: Task;

  beforeEach(() => {
    task = makeTask();
  });

  it('handles plan action — stores plan on task and returns confirmation', async () => {
    const ctx = makeCtx(task);
    const plan: OrchestratorPlan = {
      objective: 'Analyze markets',
      constraints: [],
      subtasks: [{ id: 'r1', prompt: 'Research', role: 'Research' }],
      successCriteria: [],
      failureCriteria: [],
      risks: [],
    };
    const result = await executeOrchestratorAction(ctx, { type: 'plan', plan });
    expect(result).toContain('Plan registered');
    expect(task.plan).toEqual(plan);
    expect(ctx.pushUpdate).toHaveBeenCalled();
  });

  it('handles task_spawn — calls spawnTask and returns taskId', async () => {
    const mockTm = {
      spawnTask: vi.fn(async () => ({ taskId: 'task_child1' })),
      get: vi.fn(() => undefined),
    };
    const ctx = makeCtx(task, mockTm);

    const result = await executeOrchestratorAction(ctx, {
      type: 'task_spawn',
      prompt: 'Do research',
      agentRole: 'Research',
      agentName: 'Scout',
    });

    expect(mockTm.spawnTask).toHaveBeenCalledWith('Do research', task.id, {
      mode: undefined,
      capabilities: undefined,
      agentRole: 'Research',
      agentName: 'Scout',
    });
    expect(result).toContain('task_child1');
    expect(task.childTaskIds).toContain('task_child1');
  });

  it('handles task_wait — calls waitForTasks and returns JSON results', async () => {
    const mockTm = {
      waitForTasks: vi.fn(async () => [{ taskId: 'task_a', status: 'completed', summary: 'Done' }]),
    };
    const ctx = makeCtx(task, mockTm);

    const result = await executeOrchestratorAction(ctx, {
      type: 'task_wait',
      taskIds: ['task_a'],
      timeoutMs: 5000,
    });

    expect(mockTm.waitForTasks).toHaveBeenCalledWith(['task_a'], 5000);
    const parsed = JSON.parse(result);
    expect(parsed[0].status).toBe('completed');
  });

  it('task_wait uses default timeout when not specified', async () => {
    const mockTm = {
      waitForTasks: vi.fn(async () => []),
    };
    const ctx = makeCtx(task, mockTm);

    await executeOrchestratorAction(ctx, { type: 'task_wait', taskIds: [] });
    // default timeout is 10 min = 600000ms
    expect(mockTm.waitForTasks).toHaveBeenCalledWith([], 600000);
  });

  it('returns error when taskManager is not available for task_spawn', async () => {
    const ctx = makeCtx(task, null);
    const result = await executeOrchestratorAction(ctx, {
      type: 'task_spawn',
      prompt: 'Do stuff',
    });
    expect(result).toContain('[Error:');
  });

  it('returns error when taskManager is not available for task_wait', async () => {
    const ctx = makeCtx(task, null);
    const result = await executeOrchestratorAction(ctx, {
      type: 'task_wait',
      taskIds: ['task_abc'],
    });
    expect(result).toContain('[Error:');
  });

  it('handles task_read — returns task status and summary', async () => {
    const mockTm = {
      get: vi.fn(() => ({ id: 'task_a', status: 'completed', summary: 'Research done' })),
      list: vi.fn(() => []),
    };
    const ctx = makeCtx(task, mockTm);
    const result = await executeOrchestratorAction(ctx, { type: 'task_read', taskId: 'task_a' });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('completed');
    expect(parsed.summary).toBe('Research done');
  });

  it('handles task_list_peers — returns list of other tasks', async () => {
    const mockTm = {
      list: vi.fn(() => [
        { id: 'task_b', prompt: 'Research China', status: 'running' },
        { id: task.id, prompt: 'Orchestrate', status: 'running' },
      ]),
    };
    const ctx = makeCtx(task, mockTm);
    const result = await executeOrchestratorAction(ctx, { type: 'task_list_peers' });
    const parsed = JSON.parse(result);
    // Should exclude self
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('task_b');
  });

  it('handles task_message — sends message to target task', async () => {
    const mockTm = {
      sendMessage: vi.fn(),
    };
    const ctx = makeCtx(task, mockTm);
    const result = await executeOrchestratorAction(ctx, {
      type: 'task_message',
      taskId: 'task_b',
      message: 'Focus on last 30 days',
    });
    expect(mockTm.sendMessage).toHaveBeenCalledWith('task_b', task.id, 'Focus on last 30 days');
    expect(result).toContain('task_b');
  });

  it('handles remember_fact — saves fact and returns confirmation', async () => {
    const ctx = makeCtx(task);
    // remember_fact calls saveFact from task-memory (mocked at module level)
    const result = await executeOrchestratorAction(ctx, {
      type: 'remember_fact',
      fact: 'Market X has low liquidity on Fridays',
    });
    expect(result).toContain('Market X has low liquidity on Fridays');
  });

  it('handles task_spawn with maxSteps and model override', async () => {
    const mockTm = {
      spawnTask: vi.fn(async () => ({ taskId: 'task_child1' })),
      get: vi.fn(() => undefined),
    };
    const ctx = makeCtx(task, mockTm);

    await executeOrchestratorAction(ctx, {
      type: 'task_spawn',
      prompt: 'Do research',
      agentRole: 'Research',
      maxSteps: 30,
      model: 'gpt-4.1-mini',
    });

    expect(mockTm.spawnTask).toHaveBeenCalledWith('Do research', task.id, {
      mode: undefined,
      capabilities: undefined,
      agentRole: 'Research',
      agentName: undefined,
      maxSteps: 30,
      model: 'gpt-4.1-mini',
    });
  });
});

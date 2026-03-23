import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../types';
import type { VisionMessage } from '../../../types';
import { callVision } from '../vision-dispatch';
import { runAgentLoop } from './agent-loop';

vi.mock('../vision-dispatch', () => ({
  callVision: vi.fn(),
}));

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-1',
    mode: 'browser',
    prompt: 'test task',
    status: 'running',
    steps: [],
    capabilities: [],
    maxSteps: 5,
    timeoutMs: 60_000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attachments: [],
    ...overrides,
  } as Task;
}

function makeMsg(role: 'user' | 'assistant', text: string): VisionMessage {
  return { role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] };
}

const DONE_RESPONSE = '{"thought":"done","action":{"type":"done","summary":"task done"}}';
const STEP_RESPONSE = '{"thought":"next step","action":{"type":"shell","command":"ls"}}';
const FAIL_RESPONSE = '{"thought":"fail","action":{"type":"fail","reason":"not found"}}';

describe('runAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns completed task when model returns done action', async () => {
    vi.mocked(callVision).mockResolvedValueOnce({ text: DONE_RESPONSE });
    const task = makeTask({ maxSteps: 3 });
    const history: VisionMessage[] = [];
    const recordStep = vi.fn();

    const result = await runAgentLoop('system prompt', history, 3, task, 'chatgpt', 'gpt-4o', {
      taskManager: null,
      buildTurnMessage: () => ({ text: 'turn 1' }),
      executeAction: vi.fn().mockResolvedValue('result'),
      recordStep,
      pushStatus: vi.fn(),
      isAborted: () => false,
    });

    expect(result.status).toBe('completed');
    expect(result.summary).toBe('task done');
    expect(recordStep).toHaveBeenCalled();
  });

  it('returns failed task when model returns fail action', async () => {
    vi.mocked(callVision).mockResolvedValueOnce({ text: FAIL_RESPONSE });
    const task = makeTask({ maxSteps: 3 });
    const history: VisionMessage[] = [];
    const recordStep = vi.fn();

    const result = await runAgentLoop('system prompt', history, 3, task, 'chatgpt', 'gpt-4o', {
      taskManager: null,
      buildTurnMessage: () => ({ text: 'turn 1' }),
      executeAction: vi.fn().mockResolvedValue('result'),
      recordStep,
      pushStatus: vi.fn(),
      isAborted: () => false,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('not found');
  });

  it('calls executeAction after each turn', async () => {
    vi.mocked(callVision)
      .mockResolvedValueOnce({ text: STEP_RESPONSE })
      .mockResolvedValueOnce({ text: STEP_RESPONSE })
      .mockResolvedValueOnce({ text: DONE_RESPONSE });
    const task = makeTask({ maxSteps: 3 });
    const history: VisionMessage[] = [];
    const executeAction = vi.fn().mockResolvedValue('ok');

    await runAgentLoop('system prompt', history, 3, task, 'chatgpt', 'gpt-4o', {
      taskManager: null,
      buildTurnMessage: () => ({ text: 'turn' }),
      executeAction,
      recordStep: vi.fn(),
      pushStatus: vi.fn(),
      isAborted: () => false,
    });

    expect(executeAction).toHaveBeenCalledTimes(2);
  });

  it('respects maxSteps limit', async () => {
    vi.mocked(callVision).mockResolvedValue({ text: STEP_RESPONSE });
    const task = makeTask({ maxSteps: 3 });
    const history: VisionMessage[] = [];
    const recordStep = vi.fn();

    const result = await runAgentLoop('system prompt', history, 3, task, 'chatgpt', 'gpt-4o', {
      taskManager: null,
      buildTurnMessage: () => ({ text: 'turn' }),
      executeAction: vi.fn().mockResolvedValue('ok'),
      recordStep,
      pushStatus: vi.fn(),
      isAborted: () => false,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('max steps');
    expect(recordStep).toHaveBeenCalledTimes(4); // 3 steps + 1 finish() call
  });

  it('stops and returns cancelled when isAborted returns true', async () => {
    const task = makeTask({ maxSteps: 3 });
    const history: VisionMessage[] = [];

    const result = await runAgentLoop('system prompt', history, 3, task, 'chatgpt', 'gpt-4o', {
      taskManager: null,
      buildTurnMessage: () => ({ text: 'turn' }),
      executeAction: vi.fn().mockResolvedValue('ok'),
      recordStep: vi.fn(),
      pushStatus: vi.fn(),
      isAborted: () => true,
    });

    expect(result.status).toBe('cancelled');
  });

  it('records step with result on success', async () => {
    vi.mocked(callVision).mockResolvedValueOnce({ text: STEP_RESPONSE }).mockResolvedValueOnce({ text: DONE_RESPONSE });
    const task = makeTask({ maxSteps: 2 });
    const history: VisionMessage[] = [];
    const recordStep = vi.fn();

    await runAgentLoop('system prompt', history, 2, task, 'chatgpt', 'gpt-4o', {
      taskManager: null,
      buildTurnMessage: () => ({ text: 'turn' }),
      executeAction: vi.fn().mockResolvedValue('shell output'),
      recordStep,
      pushStatus: vi.fn(),
      isAborted: () => false,
    });

    const step = recordStep.mock.calls[0]?.[0];
    expect(step.result).toBe('shell output');
    expect(step.error).toBeUndefined();
  });

  it('records step with error when executeAction throws', async () => {
    vi.mocked(callVision).mockResolvedValueOnce({ text: STEP_RESPONSE }).mockResolvedValueOnce({ text: DONE_RESPONSE });
    const task = makeTask({ maxSteps: 2 });
    const history: VisionMessage[] = [];
    const recordStep = vi.fn();

    await runAgentLoop('system prompt', history, 2, task, 'chatgpt', 'gpt-4o', {
      taskManager: null,
      buildTurnMessage: () => ({ text: 'turn' }),
      executeAction: vi.fn().mockRejectedValue(new Error('shell failed')),
      recordStep,
      pushStatus: vi.fn(),
      isAborted: () => false,
    });

    const step = recordStep.mock.calls[0]?.[0];
    expect(step.error).toBeDefined();
    expect(typeof step.error).toBe('string');
    expect(step.error.length).toBeGreaterThan(0);
  });

  it('accumulates usage into task.usage', async () => {
    vi.mocked(callVision).mockResolvedValueOnce({ text: DONE_RESPONSE, usage: { inputTokens: 10, outputTokens: 5 } });
    const task = makeTask({ maxSteps: 1 });
    const history: VisionMessage[] = [];

    await runAgentLoop('system prompt', history, 1, task, 'chatgpt', 'gpt-4o', {
      taskManager: null,
      buildTurnMessage: () => ({ text: 'turn' }),
      executeAction: vi.fn().mockResolvedValue('ok'),
      recordStep: vi.fn(),
      pushStatus: vi.fn(),
      isAborted: () => false,
    });

    expect(task.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('passes images from buildTurnMessage into turn message', async () => {
    vi.mocked(callVision).mockResolvedValueOnce({ text: DONE_RESPONSE });
    const task = makeTask({ maxSteps: 1 });
    const history: VisionMessage[] = [];

    await runAgentLoop('system prompt', history, 1, task, 'chatgpt', 'gpt-4o', {
      taskManager: null,
      buildTurnMessage: () => ({ text: 'turn', images: ['data:image/png;base64,abc123'] }),
      executeAction: vi.fn().mockResolvedValue('ok'),
      recordStep: vi.fn(),
      pushStatus: vi.fn(),
      isAborted: () => false,
    });

    const turnMsg = history.find((m) => m.role === 'user');
    const imgContent = turnMsg?.content.find((c) => c.type === 'input_image');
    expect(imgContent).toMatchObject({ type: 'input_image', image_url: 'data:image/png;base64,abc123' });
  });
});

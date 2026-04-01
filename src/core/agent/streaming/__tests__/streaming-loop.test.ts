import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the vision-stream module to simulate streaming
vi.mock('../vision-stream', () => ({
  streamVision: vi.fn(),
}));

import { runStreamingTurn } from '../streaming-loop';
import { streamVision } from '../vision-stream';

const mockStreamVision = vi.mocked(streamVision);

/** Helper to create an async generator from chunks */
async function* chunksFrom(...items: Array<{ type: string; text?: string; fullText?: string; error?: string }>) {
  for (const item of items) {
    yield item as any;
  }
}

describe('runStreamingTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects action from complete stream and executes it', async () => {
    const fullJson = '{"thought":"running ls","action":{"type":"shell","command":"ls"}}';
    mockStreamVision.mockReturnValue(
      chunksFrom({ type: 'delta', text: fullJson }, { type: 'done', fullText: fullJson })
    );

    const executeAction = vi.fn().mockResolvedValue('file1.txt\nfile2.txt');

    const result = await runStreamingTurn('chatgpt', 'system', [], 'task-1', 'gpt-4o', executeAction);

    expect(result.action).toEqual({ type: 'shell', command: 'ls' });
    expect(result.thought).toBe('running ls');
    expect(result.result).toBe('file1.txt\nfile2.txt');
    expect(result.error).toBeUndefined();
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it('detects action from incremental streaming', async () => {
    const part1 = '{"thought":"click","action":{"type":"click","x":1';
    const part2 = '00,"y":200}}';

    mockStreamVision.mockReturnValue(
      chunksFrom(
        { type: 'delta', text: part1 },
        { type: 'delta', text: part2 },
        { type: 'done', fullText: part1 + part2 }
      )
    );

    const executeAction = vi.fn().mockResolvedValue('clicked');

    const result = await runStreamingTurn('chatgpt', 'system', [], 'task-1', 'gpt-4o', executeAction);

    expect(result.action).toEqual({ type: 'click', x: 100, y: 200 });
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it('calls onDelta callback for each chunk', async () => {
    const fullJson = '{"thought":"done","action":{"type":"done","summary":"ok"}}';
    mockStreamVision.mockReturnValue(
      chunksFrom(
        { type: 'delta', text: '{"thought":"done",' },
        { type: 'delta', text: '"action":{"type":"done","summary":"ok"}}' },
        { type: 'done', fullText: fullJson }
      )
    );

    const onDelta = vi.fn();
    const executeAction = vi.fn().mockResolvedValue(undefined);

    await runStreamingTurn('chatgpt', 'system', [], 'task-1', 'gpt-4o', executeAction, { onDelta });

    expect(onDelta).toHaveBeenCalledTimes(2);
  });

  it('calls onActionReady callback when action detected', async () => {
    const fullJson = '{"action":{"type":"shell","command":"pwd"}}';
    mockStreamVision.mockReturnValue(
      chunksFrom({ type: 'delta', text: fullJson }, { type: 'done', fullText: fullJson })
    );

    const onActionReady = vi.fn();
    const executeAction = vi.fn().mockResolvedValue('/home');

    await runStreamingTurn('chatgpt', 'system', [], 'task-1', 'gpt-4o', executeAction, { onActionReady });

    expect(onActionReady).toHaveBeenCalledTimes(1);
    expect(onActionReady).toHaveBeenCalledWith({ type: 'shell', command: 'pwd' }, undefined);
  });

  it('calls onActionResult callback after execution', async () => {
    const fullJson = '{"action":{"type":"shell","command":"pwd"}}';
    mockStreamVision.mockReturnValue(
      chunksFrom({ type: 'delta', text: fullJson }, { type: 'done', fullText: fullJson })
    );

    const onActionResult = vi.fn();
    const executeAction = vi.fn().mockResolvedValue('/home');

    await runStreamingTurn('chatgpt', 'system', [], 'task-1', 'gpt-4o', executeAction, { onActionResult });

    expect(onActionResult).toHaveBeenCalledWith('/home', undefined);
  });

  it('handles stream error gracefully', async () => {
    mockStreamVision.mockReturnValue(chunksFrom({ type: 'error', error: 'Network timeout' }));

    const executeAction = vi.fn();

    const result = await runStreamingTurn('chatgpt', 'system', [], 'task-1', 'gpt-4o', executeAction);

    expect(result.action).toEqual({ type: 'fail', reason: 'Network timeout' });
    expect(result.error).toBe('Network timeout');
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('handles unparseable response', async () => {
    mockStreamVision.mockReturnValue(
      chunksFrom(
        { type: 'delta', text: 'this is not json at all' },
        { type: 'done', fullText: 'this is not json at all' }
      )
    );

    const executeAction = vi.fn();

    const result = await runStreamingTurn('chatgpt', 'system', [], 'task-1', 'gpt-4o', executeAction);

    expect(result.action.type).toBe('fail');
    expect(result.error).toBeDefined();
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('applies budget to large results', async () => {
    const fullJson = '{"action":{"type":"shell","command":"cat bigfile"}}';
    mockStreamVision.mockReturnValue(
      chunksFrom({ type: 'delta', text: fullJson }, { type: 'done', fullText: fullJson })
    );

    const bigResult = 'x'.repeat(15_000);
    const executeAction = vi.fn().mockResolvedValue(bigResult);

    const result = await runStreamingTurn('chatgpt', 'system', [], 'task-1', 'gpt-4o', executeAction);

    expect(result.result!.length).toBeLessThan(13_000);
    expect(result.result).toContain('truncated');
  });

  it('records error when executeAction throws', async () => {
    const fullJson = '{"action":{"type":"shell","command":"bad"}}';
    mockStreamVision.mockReturnValue(
      chunksFrom({ type: 'delta', text: fullJson }, { type: 'done', fullText: fullJson })
    );

    const executeAction = vi.fn().mockRejectedValue(new Error('command not found'));

    const result = await runStreamingTurn('chatgpt', 'system', [], 'task-1', 'gpt-4o', executeAction);

    expect(result.error).toBe('command not found');
    expect(result.result).toBeUndefined();
  });

  it('returns usage from done chunk', async () => {
    const fullJson = '{"action":{"type":"done","summary":"ok"}}';
    const usage = { inputTokens: 100, outputTokens: 50 };
    mockStreamVision.mockReturnValue(
      chunksFrom({ type: 'delta', text: fullJson }, { type: 'done', fullText: fullJson, ...{ usage } })
    );

    const executeAction = vi.fn().mockResolvedValue(undefined);

    const result = await runStreamingTurn('chatgpt', 'system', [], 'task-1', 'gpt-4o', executeAction);

    expect(result.usage).toEqual(usage);
  });
});

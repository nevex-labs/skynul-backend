import { describe, expect, it, vi } from 'vitest';
import { type ChatMessage, type LoopCallbacks, type LoopOpts, parseActionResponse, runAgentLoop } from './agent-loop';

// ── parseActionResponse ────────────────────────────────────────────────

describe('parseActionResponse', () => {
  it('parses JSON with thought and action', () => {
    const raw = JSON.stringify({
      thought: 'I should list files',
      action: { type: 'cmd.run', command: 'ls -la' },
    });

    const result = parseActionResponse(raw);
    expect(result.thought).toBe('I should list files');
    expect(result.action.type).toBe('cmd.run');
    expect('summary' in result.action).toBe(false);
  });

  it('parses fenced JSON', () => {
    const raw = '```json\n{"thought": "thinking", "action": {"type": "done", "summary": "done"}}\n```';
    const result = parseActionResponse(raw);
    expect(result.thought).toBe('thinking');
    expect(result.action.type).toBe('done');
  });

  it('parses unfenced JSON with surrounding text', () => {
    const raw = 'Let me think...\n{"action": {"type": "fail", "reason": "cant do it"}}\n...thats it';
    const result = parseActionResponse(raw);
    expect(result.action.type).toBe('fail');
  });

  it('falls back to done for plain text', () => {
    const raw = 'The weather is sunny today.';
    const result = parseActionResponse(raw);
    expect(result.action.type).toBe('done');
    if (result.action.type === 'done') {
      expect(result.action.summary).toBe('The weather is sunny today.');
    }
  });

  it('handles action at root level (no nested action key)', () => {
    const raw = JSON.stringify({ type: 'browser.navigate', url: 'https://example.com' });
    const result = parseActionResponse(raw);
    expect(result.action.type).toBe('browser.navigate');
  });
});

// ── runAgentLoop ───────────────────────────────────────────────────────

function makeCallbacks(overrides: Partial<LoopCallbacks> = {}): LoopCallbacks {
  return {
    executeAction: vi.fn().mockResolvedValue('ok'),
    isAborted: vi.fn().mockReturnValue(false),
    pushStatus: vi.fn(),
    recordStep: vi.fn(),
    ...overrides,
  };
}

function makeOpts(overrides: Partial<LoopOpts> = {}): LoopOpts {
  return {
    systemPrompt: 'You are a helpful assistant.',
    history: [],
    provider: 'gemini',
    callLLM: vi.fn().mockResolvedValue(JSON.stringify({ type: 'done', summary: 'finished' })),
    callbacks: makeCallbacks(),
    maxSteps: 10,
    ...overrides,
  };
}

describe('runAgentLoop', () => {
  it('completes when LLM returns done action', async () => {
    const opts = makeOpts();
    const result = await runAgentLoop(opts);

    expect(result.status).toBe('completed');
    expect(result.summary).toBe('finished');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].action.type).toBe('done');
  });

  it('fails when LLM returns fail action', async () => {
    const opts = makeOpts({
      callLLM: vi.fn().mockResolvedValue(JSON.stringify({ type: 'fail', reason: 'something broke' })),
    });
    const result = await runAgentLoop(opts);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('something broke');
  });

  it('executes actions and continues', async () => {
    const executeAction = vi
      .fn()
      .mockResolvedValueOnce('file list: a.txt, b.txt')
      .mockResolvedValueOnce('content of a.txt');

    const callLLM = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ type: 'fs.read', path: 'a.txt' }))
      .mockResolvedValueOnce(JSON.stringify({ type: 'done', summary: 'read file' }));

    const opts = makeOpts({
      callLLM,
      callbacks: makeCallbacks({ executeAction }),
    });

    const result = await runAgentLoop(opts);

    expect(result.status).toBe('completed');
    expect(result.summary).toBe('read file');
    expect(result.steps).toHaveLength(2);
    // Only the first action (fs.read) is executed; done is terminal
    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('respects maxSteps limit', async () => {
    const opts = makeOpts({
      callLLM: vi.fn().mockResolvedValue(JSON.stringify({ type: 'cmd.run', cmd: 'echo hi' })),
      maxSteps: 3,
    });

    const result = await runAgentLoop(opts);

    expect(result.status).toBe('max_steps');
    expect(result.error).toContain('Reached max steps');
    expect(result.steps).toHaveLength(3);
  });

  it('handles LLM errors gracefully', async () => {
    const opts = makeOpts({
      callLLM: vi.fn().mockRejectedValue(new Error('Network timeout')),
    });

    const result = await runAgentLoop(opts);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Network timeout');
  });

  it('respects allowedTools restriction', async () => {
    const executeAction = vi.fn().mockResolvedValue('ok');

    const opts = makeOpts({
      callLLM: vi.fn().mockResolvedValue(JSON.stringify({ type: 'cmd.run', cmd: 'rm -rf /' })),
      callbacks: makeCallbacks({
        executeAction,
        allowedTools: ['fs.read', 'fs.write'],
      }),
    });

    const result = await runAgentLoop(opts);

    // Action was blocked, so loop continues to next step (max_steps)
    expect(result.status).toBe('max_steps');
    expect(result.steps[0].error).toContain('not allowed');
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('handles action execution errors', async () => {
    const executeAction = vi.fn().mockRejectedValue(new Error('Permission denied'));

    const callLLM = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ type: 'cmd.run', cmd: 'sudo rm -rf /' }))
      .mockResolvedValueOnce(JSON.stringify({ type: 'done', summary: 'gave up' }));

    const opts = makeOpts({
      callLLM,
      callbacks: makeCallbacks({ executeAction }),
    });

    const result = await runAgentLoop(opts);

    expect(result.status).toBe('completed');
    expect(result.steps[0].error).toBe('Permission denied');
    expect(result.steps[0].result).toBeUndefined();
  });

  it('checks isAborted between turns', async () => {
    let callCount = 0;
    const callLLM = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return JSON.stringify({ type: 'cmd.run', cmd: 'echo 1' });
      return JSON.stringify({ type: 'done', summary: 'done' });
    });

    const isAborted = vi
      .fn()
      .mockReturnValueOnce(false) // before turn 1
      .mockReturnValueOnce(false) // before turn 2
      .mockReturnValueOnce(true); // after turn 1, before turn 2

    const opts = makeOpts({
      callLLM,
      callbacks: makeCallbacks({ isAborted }),
    });

    const result = await runAgentLoop(opts);

    expect(result.status).toBe('cancelled');
  });

  it('pushes status updates', async () => {
    const pushStatus = vi.fn();
    const opts = makeOpts({
      callbacks: makeCallbacks({ pushStatus }),
    });

    await runAgentLoop(opts);

    expect(pushStatus).toHaveBeenCalledWith('Thinking...');
  });

  it('records steps via callback', async () => {
    const recordStep = vi.fn();
    const opts = makeOpts({
      callbacks: makeCallbacks({ recordStep }),
    });

    await runAgentLoop(opts);

    expect(recordStep).toHaveBeenCalledTimes(1);
    expect(recordStep.mock.calls[0][0].index).toBe(0);
  });

  it('tracks context tokens', async () => {
    const opts = makeOpts();
    const result = await runAgentLoop(opts);

    expect(result.steps[0].contextTokens).toBeDefined();
    expect(result.steps[0].contextTokens!.max).toBe(128_000); // default
  });

  it('uses custom context window', async () => {
    const opts = makeOpts({
      contextWindow: 32_000,
    });
    const result = await runAgentLoop(opts);

    expect(result.steps[0].contextTokens!.max).toBe(32_000);
  });
});

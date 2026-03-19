import { describe, expect, it, vi } from 'vitest';
import type { VisionMessage } from '../providers/codex-vision';
import { buildActionLog, compressHistory, drainInbox, truncateHistory } from './history-manager';
import type { TaskManager } from './task-manager';

function makeMsg(role: 'user' | 'assistant', text: string): VisionMessage {
  return { role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] };
}

function makeStep(type: string, result?: string, error?: string, thought?: string) {
  return {
    index: 0,
    timestamp: 0,
    screenshotBase64: '',
    action: { type } as any,
    result,
    error,
    thought,
  };
}

describe('compressHistory', () => {
  it('no-op when history length <= 8', () => {
    const history = Array.from({ length: 8 }, (_, i) => makeMsg('user', `msg${i}`));
    compressHistory(history);
    expect(history.length).toBe(8);
  });

  it('summarizes middle messages when > 8', () => {
    // 11 items: keepTail=6. slice(1, 5) = 4 middle items → splice(1, 4, ...) replaces with 1.
    // Final: 1 (init) + 1 (summary) + 6 (tail) = 8 items.
    const history = [
      makeMsg('user', 'init'),
      makeMsg('assistant', '{"action":{"type":"click"}}'),
      makeMsg('assistant', '{"action":{"type":"type"}}'),
      makeMsg('assistant', '{"action":{"type":"done"}}'),
      makeMsg('user', 'intermediate'),
      makeMsg('assistant', '{"action":{"type":"scroll"}}'),
      makeMsg('assistant', '{"action":{"type":"click"}}'),
      makeMsg('user', 'tail1'),
      makeMsg('user', 'tail2'),
      makeMsg('user', 'tail3'),
      makeMsg('user', 'tail4'),
    ];
    compressHistory(history, 6);
    expect(history.length).toBe(8);
    expect(history[0]).toEqual(makeMsg('user', 'init'));
    expect(history[1].role).toBe('user');
    expect(history[1].content[0]).toMatchObject({ type: 'input_text' });
    expect((history[1].content[0] as { text: string }).text).toContain('click → type → done');
  });

  it('only includes assistant message types in summary', () => {
    // 13 items: keepTail=6. slice(1, 7) = 6 middle items. Only assistant roles included.
    const history = [
      makeMsg('user', 'init'),
      makeMsg('user', 'skip1'),
      makeMsg('assistant', '{"action":{"type":"navigate"}}'),
      makeMsg('user', 'skip2'),
      makeMsg('assistant', '{"action":{"type":"press"}}'),
      makeMsg('assistant', '{"action":{"type":"done"}}'),
      makeMsg('assistant', '{"action":{"type":"click"}}'),
      makeMsg('user', 'tail1'),
      makeMsg('user', 'tail2'),
      makeMsg('user', 'tail3'),
      makeMsg('user', 'tail4'),
      makeMsg('user', 'tail5'),
      makeMsg('user', 'tail6'),
    ];
    compressHistory(history, 6);
    const summary = (history[1].content[0] as { text: string }).text;
    expect(summary).toBe('[Previous actions: navigate → press → done → click]');
  });

  it('replaces middle with single user summary message', () => {
    // 10 items: keepTail=4. slice(1, 6) = 5 middle items → splice(1, 5, ...) replaces with 1.
    // Final: 1 (init) + 1 (summary) + 4 (tail) = 6 items.
    const history = [
      makeMsg('user', 'always-keep'),
      makeMsg('assistant', '{"action":{"type":"a"}}'),
      makeMsg('assistant', '{"action":{"type":"b"}}'),
      makeMsg('assistant', '{"action":{"type":"c"}}'),
      makeMsg('user', 'ignore1'),
      makeMsg('assistant', '{"action":{"type":"d"}}'),
      makeMsg('user', 'ignore2'),
      makeMsg('user', 'tail1'),
      makeMsg('user', 'tail2'),
      makeMsg('user', 'tail3'),
    ];
    compressHistory(history, 4);
    expect(history.length).toBe(6);
    expect(history[1].role).toBe('user');
    expect(history[0]).toEqual(makeMsg('user', 'always-keep'));
  });
});

describe('truncateHistory', () => {
  it('no-op when history length <= keepCount', () => {
    const history = Array.from({ length: 19 }, (_, i) => makeMsg('user', `msg${i}`));
    truncateHistory(history, 19);
    expect(history.length).toBe(19);
  });

  it('truncates to keepCount when length > keepCount', () => {
    const history = Array.from({ length: 30 }, (_, i) => makeMsg('user', `msg${i}`));
    truncateHistory(history, 19);
    expect(history.length).toBe(19);
  });

  it('keeps first message always', () => {
    const history = [
      makeMsg('user', 'always-keep'),
      ...Array.from({ length: 25 }, (_, i) => makeMsg('assistant', `msg${i}`)),
    ];
    truncateHistory(history, 10);
    expect(history[0]).toEqual(makeMsg('user', 'always-keep'));
    expect(history.length).toBe(10);
  });

  it('handles exactly keepCount', () => {
    const history = Array.from({ length: 10 }, (_, i) => makeMsg('user', `msg${i}`));
    truncateHistory(history, 10);
    expect(history.length).toBe(10);
  });
});

describe('buildActionLog', () => {
  it('returns empty string when no steps', () => {
    const log = buildActionLog([]);
    expect(log).toContain('Recent actions:');
    expect(log).toContain('Do NOT repeat');
  });

  it('formats step with result', () => {
    const steps = [makeStep('click', 'Clicked button')];
    const log = buildActionLog(steps);
    expect(log).toContain('Step 1: click → Clicked button');
  });

  it('formats step with error', () => {
    const steps = [makeStep('click', undefined, 'Element not found')];
    const log = buildActionLog(steps);
    expect(log).toContain('[ERROR: Element not found]');
  });

  it('adds truncated note when thought contains truncated', () => {
    const steps = [makeStep('click', 'ok', undefined, 'my response was truncated')];
    const log = buildActionLog(steps);
    expect(log).toContain('YOUR RESPONSE WAS TRUNCATED');
  });

  it('respects truncateResult option', () => {
    const steps = [makeStep('shell', 'x'.repeat(500))];
    const log = buildActionLog(steps, 8, { truncateResult: 50 });
    expect(log).not.toContain('x'.repeat(500));
  });

  it('respects truncateError option', () => {
    const steps = [makeStep('click', undefined, 'y'.repeat(300))];
    const log = buildActionLog(steps, 8, { truncateError: 20 });
    expect(log).not.toContain('y'.repeat(300));
  });

  it('includes failed selectors when includeFailedSelectors is true', () => {
    const steps = [
      {
        index: 0,
        timestamp: 0,
        screenshotBase64: '',
        action: { type: 'click', selector: '#bad' } as any,
        error: 'failed',
      },
    ];
    const log = buildActionLog(steps, 8, { includeFailedSelectors: true });
    expect(log).toContain('⚠ FAILED SELECTORS');
    expect(log).toContain('#bad');
  });

  it('does not include failed selectors section when none', () => {
    const steps = [makeStep('done', 'ok')];
    const log = buildActionLog(steps, 8, { includeFailedSelectors: true });
    expect(log).not.toContain('⚠ FAILED SELECTORS');
  });

  it('limits to last maxRecent steps', () => {
    const steps = [
      { index: 0, timestamp: 0, screenshotBase64: '', action: { type: 'a' } as any, result: '1' },
      { index: 1, timestamp: 0, screenshotBase64: '', action: { type: 'b' } as any, result: '2' },
      { index: 2, timestamp: 0, screenshotBase64: '', action: { type: 'c' } as any, result: '3' },
      { index: 3, timestamp: 0, screenshotBase64: '', action: { type: 'd' } as any, result: '4' },
      { index: 4, timestamp: 0, screenshotBase64: '', action: { type: 'e' } as any, result: '5' },
      { index: 5, timestamp: 0, screenshotBase64: '', action: { type: 'f' } as any, result: '6' },
      { index: 6, timestamp: 0, screenshotBase64: '', action: { type: 'g' } as any, result: '7' },
      { index: 7, timestamp: 0, screenshotBase64: '', action: { type: 'h' } as any, result: '8' },
      { index: 8, timestamp: 0, screenshotBase64: '', action: { type: 'i' } as any, result: '9' },
    ];
    const log = buildActionLog(steps, 3);
    expect(log).toContain('Step 7: g → 7');
    expect(log).not.toContain('Step 1: a → 1');
  });
});

describe('drainInbox', () => {
  it('returns empty string when taskManager is null', () => {
    expect(drainInbox(null, 'task-1')).toBe('');
  });

  it('returns empty string when no messages', () => {
    const tm = { drainMessages: vi.fn().mockReturnValue([]) } as any as TaskManager;
    expect(drainInbox(tm, 'task-1')).toBe('');
  });

  it('formats messages correctly', () => {
    const tm = {
      drainMessages: vi.fn().mockReturnValue([
        { from: 'Agent-Copy', message: '3 tweet options ready' },
        { from: 'Agent-Design', message: 'image prompt ready' },
      ]),
    } as any as TaskManager;
    const result = drainInbox(tm, 'task-1');
    expect(result).toContain('[INCOMING MESSAGES]');
    expect(result).toContain('From Agent-Copy: 3 tweet options ready');
    expect(result).toContain('From Agent-Design: image prompt ready');
    expect(result).toContain('[/INCOMING MESSAGES]');
  });

  it('calls drainMessages with correct taskId', () => {
    const tm = { drainMessages: vi.fn().mockReturnValue([]) } as any as TaskManager;
    drainInbox(tm, 'my-task-id');
    expect(tm.drainMessages).toHaveBeenCalledWith('my-task-id');
  });
});

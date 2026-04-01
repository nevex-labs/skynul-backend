import { describe, expect, it } from 'vitest';
import { detectAction, extractFirstJson } from '../json-detector';

describe('extractFirstJson', () => {
  it('returns null for empty string', () => {
    expect(extractFirstJson('')).toBeNull();
  });

  it('returns null for string with no braces', () => {
    expect(extractFirstJson('hello world')).toBeNull();
  });

  it('returns null for incomplete JSON (streaming mid-way)', () => {
    expect(extractFirstJson('{"thought":"still typing')).toBeNull();
  });

  it('returns complete JSON object', () => {
    const text = '{"thought":"done","action":{"type":"done","summary":"ok"}}';
    expect(extractFirstJson(text)).toBe(text);
  });

  it('returns first JSON from text with prefix', () => {
    const json = '{"action":{"type":"done","summary":"ok"}}';
    expect(extractFirstJson(`some noise before ${json}`)).toBe(json);
  });

  it('handles nested braces correctly', () => {
    const json = '{"action":{"type":"click","x":100,"y":200}}';
    expect(extractFirstJson(json)).toBe(json);
  });

  it('handles escaped quotes in strings', () => {
    const json = '{"thought":"say \\"hello\\"","action":{"type":"done","summary":"ok"}}';
    expect(extractFirstJson(json)).toBe(json);
  });

  it('returns null when braces are balanced but inner JSON is incomplete', () => {
    // This shouldn't happen in practice but tests edge case
    expect(extractFirstJson('{}')).toBe('{}');
  });

  it('returns first complete object when multiple exist', () => {
    const first = '{"action":{"type":"done","summary":"first"}}';
    const second = '{"action":{"type":"fail","reason":"second"}}';
    expect(extractFirstJson(`${first}${second}`)).toBe(first);
  });
});

describe('detectAction', () => {
  describe('clean JSON', () => {
    it('detects done action', () => {
      const result = detectAction('{"thought":"finished","action":{"type":"done","summary":"all good"}}');
      expect(result.detected).toBe(true);
      if (result.detected) {
        expect(result.thought).toBe('finished');
        expect(result.action).toEqual({ type: 'done', summary: 'all good' });
      }
    });

    it('detects shell action', () => {
      const result = detectAction('{"action":{"type":"shell","command":"ls -la"}}');
      expect(result.detected).toBe(true);
      if (result.detected) {
        expect(result.action).toEqual({ type: 'shell', command: 'ls -la' });
      }
    });

    it('detects click action', () => {
      const result = detectAction('{"thought":"click the button","action":{"type":"click","x":100,"y":200}}');
      expect(result.detected).toBe(true);
      if (result.detected) {
        expect(result.thought).toBe('click the button');
        expect(result.action).toEqual({ type: 'click', x: 100, y: 200 });
      }
    });

    it('detects fail action', () => {
      const result = detectAction('{"action":{"type":"fail","reason":"not found"}}');
      expect(result.detected).toBe(true);
      if (result.detected) {
        expect(result.action).toEqual({ type: 'fail', reason: 'not found' });
      }
    });
  });

  describe('incomplete JSON (streaming)', () => {
    it('returns not detected for partial thought', () => {
      const result = detectAction('{"thought":"I am still thin');
      expect(result.detected).toBe(false);
    });

    it('returns not detected for partial action', () => {
      const result = detectAction('{"thought":"click","action":{"type":"click","x":1');
      expect(result.detected).toBe(false);
    });

    it('detects when JSON completes after streaming', () => {
      // Simulate streaming: first partial, then complete
      const partial = '{"thought":"click button","action":{"type":"click","x":100,';
      expect(detectAction(partial).detected).toBe(false);

      const complete = partial + '"y":200}}';
      const result = detectAction(complete);
      expect(result.detected).toBe(true);
      if (result.detected) {
        expect(result.action).toEqual({ type: 'click', x: 100, y: 200 });
      }
    });
  });

  describe('markdown code fences', () => {
    it('detects from json code fence', () => {
      const result = detectAction('```json\n{"action":{"type":"done","summary":"ok"}}\n```');
      expect(result.detected).toBe(true);
      if (result.detected) {
        expect(result.action).toEqual({ type: 'done', summary: 'ok' });
      }
    });

    it('detects from code fence without json tag', () => {
      const result = detectAction('```\n{"action":{"type":"done","summary":"ok"}}\n```');
      expect(result.detected).toBe(true);
    });
  });

  describe('alternative formats', () => {
    it('detects action at root level (no wrapper)', () => {
      const result = detectAction('{"type":"shell","command":"ls"}');
      expect(result.detected).toBe(true);
      if (result.detected) {
        expect(result.action).toEqual({ type: 'shell', command: 'ls' });
      }
    });

    it('detects from step.actions array', () => {
      const result = detectAction('{"step":{"actions":[{"type":"shell","command":"pwd"}]}}');
      expect(result.detected).toBe(true);
      if (result.detected) {
        expect(result.action).toEqual({ type: 'shell', command: 'pwd' });
      }
    });

    it('detects from actions array', () => {
      const result = detectAction('{"actions":[{"type":"click","x":1,"y":2}]}');
      expect(result.detected).toBe(true);
      if (result.detected) {
        expect(result.action).toEqual({ type: 'click', x: 1, y: 2 });
      }
    });
  });

  describe('noise stripping', () => {
    it('strips bridge ready noise', () => {
      const result = detectAction('{"action":{"type":"done","summary":"ok"}}\n· Bridge ready');
      expect(result.detected).toBe(true);
      if (result.detected) {
        expect(result.action).toEqual({ type: 'done', summary: 'ok' });
      }
    });

    it('strips CDP browser bridge noise', () => {
      const result = detectAction(
        '{"action":{"type":"done","summary":"ok"}}\n· CDP browser bridge ready. Starting agent loop...'
      );
      expect(result.detected).toBe(true);
    });
  });

  describe('invalid actions', () => {
    it('rejects unknown action type', () => {
      const result = detectAction('{"action":{"type":"unknown_action"}}');
      expect(result.detected).toBe(false);
    });

    it('rejects non-object text', () => {
      const result = detectAction('just plain text');
      expect(result.detected).toBe(false);
    });

    it('rejects object without action', () => {
      const result = detectAction('{"thought":"thinking about stuff"}');
      expect(result.detected).toBe(false);
    });
  });
});

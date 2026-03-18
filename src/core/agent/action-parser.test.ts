import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseModelResponse } from './action-parser';

describe('parseModelResponse', () => {
  describe('clean JSON', () => {
    it('parses simple click action', () => {
      const result = parseModelResponse('{"thought":"click the button","action":{"type":"click","x":100,"y":200}}');
      expect(result.thought).toBe('click the button');
      expect(result.action).toEqual({ type: 'click', x: 100, y: 200 });
    });

    it('parses done action', () => {
      const result = parseModelResponse('{"action":{"type":"done","summary":"Task completed"}}');
      expect(result.action).toEqual({ type: 'done', summary: 'Task completed' });
    });

    it('parses fail action', () => {
      const result = parseModelResponse('{"action":{"type":"fail","reason":"Element not found"}}');
      expect(result.action).toEqual({ type: 'fail', reason: 'Element not found' });
    });

    it('parses without thought field', () => {
      const result = parseModelResponse('{"action":{"type":"done","summary":"ok"}}');
      expect(result.action).toEqual({ type: 'done', summary: 'ok' });
    });

    it('parses type action', () => {
      const result = parseModelResponse('{"action":{"type":"type","text":"hello world"}}');
      expect(result.action).toEqual({ type: 'type', text: 'hello world' });
    });

    it('parses navigate action', () => {
      const result = parseModelResponse('{"action":{"type":"navigate","url":"https://example.com"}}');
      expect(result.action).toEqual({ type: 'navigate', url: 'https://example.com' });
    });

    it('parses shell action', () => {
      const result = parseModelResponse('{"action":{"type":"shell","command":"ls -la"}}');
      expect(result.action).toEqual({ type: 'shell', command: 'ls -la' });
    });

    it('parses task_send action', () => {
      const result = parseModelResponse('{"action":{"type":"task_send","prompt":"do something","agentRole":"Research"}}');
      expect(result.action).toEqual({ type: 'task_send', prompt: 'do something', agentRole: 'Research' });
    });

    it('parses generate_image action', () => {
      const result = parseModelResponse('{"action":{"type":"generate_image","prompt":"a cat","size":"1024x1024"}}');
      expect(result.action).toEqual({ type: 'generate_image', prompt: 'a cat', size: '1024x1024' });
    });
  });

  describe('markdown code fences', () => {
    it('parses json code fence', () => {
      const result = parseModelResponse('```json\n{"action":{"type":"done","summary":"ok"}}\n```');
      expect(result.action).toEqual({ type: 'done', summary: 'ok' });
    });

    it('parses code fence without json tag', () => {
      const result = parseModelResponse('```\n{"action":{"type":"done","summary":"ok"}}\n```');
      expect(result.action).toEqual({ type: 'done', summary: 'ok' });
    });

    it('extracts first JSON from multiple fences', () => {
      const result = parseModelResponse('```json\n{"action":{"type":"done","summary":"first"}}\n```\n```json\n{"action":{"type":"fail","reason":"second"}}\n```');
      expect(result.action).toEqual({ type: 'done', summary: 'first' });
    });
  });

  describe('noise stripping', () => {
    it('strips trailing bridge ready noise', () => {
      const result = parseModelResponse('{"action":{"type":"done","summary":"ok"}}\n· Bridge ready');
      expect(result.action).toEqual({ type: 'done', summary: 'ok' });
    });

    it('strips starting agent loop noise', () => {
      const result = parseModelResponse('Starting agent loop...\n{"action":{"type":"done","summary":"ok"}}');
      expect(result.action).toEqual({ type: 'done', summary: 'ok' });
    });

    it('strips CDP browser bridge noise', () => {
      const result = parseModelResponse('{"thought":"hi","action":{"type":"done","summary":"ok"}}\n· CDP browser bridge ready');
      expect(result.action).toEqual({ type: 'done', summary: 'ok' });
    });
  });

  describe('alternative formats', () => {
    it('parses step.actions format', () => {
      const result = parseModelResponse('{"step":{"actions":[{"type":"click","x":10,"y":20}]}}');
      expect(result.action).toEqual({ type: 'click', x: 10, y: 20 });
    });

    it('parses actions array format', () => {
      const result = parseModelResponse('{"actions":[{"type":"navigate","url":"https://x.com"}]}');
      expect(result.action).toEqual({ type: 'navigate', url: 'https://x.com' });
    });

    it('parses flat type format', () => {
      const result = parseModelResponse('{"type":"done","summary":"done!"}');
      expect(result.action).toEqual({ type: 'done', summary: 'done!' });
    });
  });

  describe('error cases', () => {
    it('throws on empty string', () => {
      expect(() => parseModelResponse('')).toThrow('Could not parse');
    });

    it('throws on random text', () => {
      expect(() => parseModelResponse('hello world')).toThrow('Could not parse');
    });

    it('treats missing action as truncated response', () => {
      const result = parseModelResponse('{"thought":"hi"}');
      expect(result.action).toEqual({ type: 'wait', ms: 500 });
    });

    it('throws on unknown action type', () => {
      expect(() => parseModelResponse('{"action":{"type":"flyToTheMoon"}}')).toThrow('Could not parse');
    });
  });
});

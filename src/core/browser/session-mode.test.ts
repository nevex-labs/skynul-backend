import { describe, expect, it } from 'vitest';
import { isPerTaskBrowserSessionMode, parseBrowserSessionMode } from './session-mode';

describe('parseBrowserSessionMode', () => {
  it('defaults to per-task when env is undefined', () => {
    expect(parseBrowserSessionMode(undefined)).toBe('per-task');
  });

  it('returns shared for empty string (not nullish)', () => {
    expect(parseBrowserSessionMode('')).toBe('shared');
  });

  it('returns per-task for "per-task"', () => {
    expect(parseBrowserSessionMode('per-task')).toBe('per-task');
  });

  it('returns per-task for "per_task"', () => {
    expect(parseBrowserSessionMode('per_task')).toBe('per-task');
  });

  it('returns per-task for "task"', () => {
    expect(parseBrowserSessionMode('task')).toBe('per-task');
  });

  it('returns shared for "shared"', () => {
    expect(parseBrowserSessionMode('shared')).toBe('shared');
  });

  it('is case-insensitive', () => {
    expect(parseBrowserSessionMode('SHARED')).toBe('shared');
    expect(parseBrowserSessionMode('Per-Task')).toBe('per-task');
  });

  it('trims whitespace', () => {
    expect(parseBrowserSessionMode('  shared  ')).toBe('shared');
    expect(parseBrowserSessionMode('  per-task  ')).toBe('per-task');
  });

  it('falls back to shared for unknown values', () => {
    expect(parseBrowserSessionMode('something-else')).toBe('shared');
  });
});

describe('isPerTaskBrowserSessionMode', () => {
  it('returns true for per-task', () => {
    expect(isPerTaskBrowserSessionMode('per-task')).toBe(true);
  });

  it('returns false for shared', () => {
    expect(isPerTaskBrowserSessionMode('shared')).toBe(false);
  });
});

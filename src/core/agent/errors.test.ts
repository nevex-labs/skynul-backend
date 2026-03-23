import { describe, expect, it } from 'vitest';
import { type ErrorCode, formatError, formatStepError, formatTaskError } from './errors';

describe('formatError', () => {
  it('classifies rate limit (429)', () => {
    const result = formatError('429 Too Many Requests - usage_limit_reached');
    expect(result.code).toBe('RATE_LIMIT');
    expect(result.isRetryable).toBe(true);
    expect(result.userMessage).toContain('límite');
  });

  it('classifies auth failure (401/403)', () => {
    const result = formatError('401 Unauthorized - invalid API key');
    expect(result.code).toBe('AUTH_FAILURE');
    expect(result.isRetryable).toBe(false);
    expect(result.userMessage).toContain('autenticación');
  });

  it('classifies network error', () => {
    const result = formatError('ETIMEDOUT connection refused');
    expect(result.code).toBe('NETWORK_ERROR');
    expect(result.isRetryable).toBe(true);
    expect(result.userMessage).toContain('conexión');
  });

  it('classifies timeout', () => {
    const result = formatError('Request timed out after 30000ms');
    expect(result.code).toBe('TIMEOUT');
    expect(result.isRetryable).toBe(true);
    expect(result.userMessage).toContain('tardó');
  });

  it('classifies browser launch failure', () => {
    const result = formatError('Chrome launch failed: executable not found');
    expect(result.code).toBe('BROWSER_LAUNCH_FAILED');
    expect(result.isRetryable).toBe(true);
    expect(result.userMessage).toContain('navegador');
  });

  it('classifies model error', () => {
    const result = formatError('Model call error: API error 500');
    expect(result.code).toBe('MODEL_ERROR');
    expect(result.isRetryable).toBe(true);
  });

  it('classifies require is not defined as tool execution failed', () => {
    const result = formatError('ReferenceError: require is not defined');
    expect(result.code).toBe('TOOL_EXECUTION_FAILED');
    expect(result.isRetryable).toBe(true);
    expect(result.userMessage).toContain('herramienta');
  });

  it('handles unknown errors gracefully', () => {
    const result = formatError('Some random error');
    expect(result.code).toBe('UNKNOWN');
    expect(result.isRetryable).toBe(true);
    expect(result.userMessage).toContain('inesperado');
  });
});

describe('formatStepError', () => {
  it('returns undefined for falsy input', () => {
    expect(formatStepError(undefined).error).toBeUndefined();
    expect(formatStepError('').error).toBeUndefined();
  });

  it('formats error with code prefix', () => {
    const result = formatStepError('429 rate limit reached');
    expect(result.error).toMatch(/^\[RATE_LIMIT\]/);
    expect(result.error).toContain('límite');
  });
});

describe('formatTaskError', () => {
  it('returns undefined for no error', () => {
    expect(formatTaskError(undefined)).toBeUndefined();
  });

  it('returns formatted error with full details', () => {
    const result = formatTaskError('401 Unauthorized');
    expect(result?.error).toContain('autenticación');
    expect(result?.formatted.code).toBe('AUTH_FAILURE');
    expect(result?.formatted.isRetryable).toBe(false);
  });
});

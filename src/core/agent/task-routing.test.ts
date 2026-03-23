import { describe, expect, it } from 'vitest';
import { deriveRunner } from './task-routing';

describe('deriveRunner', () => {
  it('returns code when mode is code', () => {
    expect(deriveRunner('code', [])).toBe('code');
  });

  it('returns code when mode is code even with trading caps', () => {
    expect(deriveRunner('code', ['polymarket.trading'])).toBe('code');
  });

  it('returns cdp when browser mode with polymarket cap', () => {
    expect(deriveRunner('browser', ['polymarket.trading'])).toBe('cdp');
  });

  it('returns cdp when browser mode with onchain cap', () => {
    expect(deriveRunner('browser', ['onchain.trading'])).toBe('cdp');
  });

  it('returns cdp when browser mode with cex cap', () => {
    expect(deriveRunner('browser', ['cex.trading'])).toBe('cdp');
  });

  it('returns browser for plain browser mode', () => {
    expect(deriveRunner('browser', [])).toBe('browser');
  });

  it('returns browser for browser mode with non-trading caps', () => {
    expect(deriveRunner('browser', ['browser.cdp', 'office.professional'])).toBe('browser');
  });

  it('returns orchestrator when orchestrate flag is true', () => {
    expect(deriveRunner('browser', [], true)).toBe('orchestrator');
  });

  it('returns orchestrator when orchestrate flag is true even with code mode', () => {
    expect(deriveRunner('code', [], true)).toBe('orchestrator');
  });

  it('returns orchestrator when orchestrate is true with trading caps', () => {
    expect(deriveRunner('browser', ['polymarket.trading'], true)).toBe('orchestrator');
  });

  it('returns browser when orchestrate is false', () => {
    expect(deriveRunner('browser', [], false)).toBe('browser');
  });
});

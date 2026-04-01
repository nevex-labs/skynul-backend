import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../playwright-cdp', () => ({
  acquirePlaywrightPage: vi.fn(),
}));

vi.mock('../playwright-bridge', () => ({
  PlaywrightBridge: class {
    snapshot = vi.fn();
    navigate = vi.fn();
    close = vi.fn();
    constructor() {}
  },
}));

import { BROWSER_ENGINE_ID } from './browser-engine';
import { acquireBrowserEngine } from './factory';

describe('acquireBrowserEngine', () => {
  const origEnv = process.env.SKYNUL_BROWSER_ENGINE;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.SKYNUL_BROWSER_ENGINE = origEnv;
  });

  it('defaults to playwright when env is not set', async () => {
    process.env.SKYNUL_BROWSER_ENGINE = '';

    const { acquirePlaywrightPage } = await import('../playwright-cdp');
    vi.mocked(acquirePlaywrightPage).mockResolvedValue({
      page: {} as any,
      release: vi.fn(),
      userDataDir: '/tmp/test',
      chromeExecutable: '/usr/bin/chrome',
    });

    const engine = await acquireBrowserEngine();
    expect(engine.engineId).toBe(BROWSER_ENGINE_ID.PLAYWRIGHT);
    expect(engine.release).toBeTypeOf('function');
    expect(acquirePlaywrightPage).toHaveBeenCalledOnce();
  });

  it('uses playwright when explicitly set', async () => {
    process.env.SKYNUL_BROWSER_ENGINE = 'playwright';

    const { acquirePlaywrightPage } = await import('../playwright-cdp');
    vi.mocked(acquirePlaywrightPage).mockResolvedValue({
      page: {} as any,
      release: vi.fn(),
      userDataDir: '/tmp/test',
      chromeExecutable: '/usr/bin/chrome',
    });

    const engine = await acquireBrowserEngine();
    expect(engine.engineId).toBe(BROWSER_ENGINE_ID.PLAYWRIGHT);
  });

  it('falls back to playwright for unknown engine with warning', async () => {
    process.env.SKYNUL_BROWSER_ENGINE = 'puppeteer';

    const { acquirePlaywrightPage } = await import('../playwright-cdp');
    vi.mocked(acquirePlaywrightPage).mockResolvedValue({
      page: {} as any,
      release: vi.fn(),
      userDataDir: '/tmp/test',
      chromeExecutable: '/usr/bin/chrome',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = await acquireBrowserEngine();

    expect(engine.engineId).toBe(BROWSER_ENGINE_ID.PLAYWRIGHT);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown SKYNUL_BROWSER_ENGINE'));
    warnSpy.mockRestore();
  });

  it('returns meta with chromeExecutable and userDataDir', async () => {
    process.env.SKYNUL_BROWSER_ENGINE = '';

    const { acquirePlaywrightPage } = await import('../playwright-cdp');
    vi.mocked(acquirePlaywrightPage).mockResolvedValue({
      page: {} as any,
      release: vi.fn(),
      userDataDir: '/tmp/my-profile',
      chromeExecutable: '/usr/bin/google-chrome',
    });

    const engine = await acquireBrowserEngine();
    expect(engine.meta).toEqual({
      chromeExecutable: '/usr/bin/google-chrome',
      userDataDir: '/tmp/my-profile',
    });
  });
});

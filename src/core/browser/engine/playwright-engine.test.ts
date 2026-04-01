import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockBridge = {
  snapshot: vi.fn(),
  navigate: vi.fn(),
  click: vi.fn(),
  type: vi.fn(),
  pressKey: vi.fn(),
  evaluate: vi.fn(),
  uploadFile: vi.fn(),
  screenshot: vi.fn(),
  close: vi.fn(),
};

vi.mock('../playwright-bridge', () => ({
  PlaywrightBridge: class {
    snapshot = mockBridge.snapshot;
    navigate = mockBridge.navigate;
    click = mockBridge.click;
    type = mockBridge.type;
    pressKey = mockBridge.pressKey;
    evaluate = mockBridge.evaluate;
    uploadFile = mockBridge.uploadFile;
    screenshot = mockBridge.screenshot;
    close = mockBridge.close;
    constructor() {}
  },
}));

vi.mock('../playwright-cdp', () => ({
  acquirePlaywrightPage: vi.fn(),
}));

import { BROWSER_ENGINE_ID } from './browser-engine';
import { acquirePlaywrightBrowserEngine } from './playwright-engine';

describe('acquirePlaywrightBrowserEngine', () => {
  const mockRelease = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockBridge.snapshot.mockResolvedValue({
      url: 'https://example.com',
      title: 'Example',
      snapshot: '- heading "Example"',
    });
    mockBridge.close.mockResolvedValue(undefined);
  });

  it('returns engine with playwright id', async () => {
    const { acquirePlaywrightPage } = await import('../playwright-cdp');
    vi.mocked(acquirePlaywrightPage).mockResolvedValue({
      page: {} as any,
      release: mockRelease,
      userDataDir: '/tmp/data',
      chromeExecutable: '/usr/bin/chrome',
    });

    const result = await acquirePlaywrightBrowserEngine();
    expect(result.engineId).toBe(BROWSER_ENGINE_ID.PLAYWRIGHT);
    expect(result.meta).toEqual({
      chromeExecutable: '/usr/bin/chrome',
      userDataDir: '/tmp/data',
    });
  });

  describe('engine methods delegate to bridge', () => {
    let engine: Awaited<ReturnType<typeof acquirePlaywrightBrowserEngine>>['engine'];

    beforeEach(async () => {
      const { acquirePlaywrightPage } = await import('../playwright-cdp');
      vi.mocked(acquirePlaywrightPage).mockResolvedValue({
        page: {} as any,
        release: mockRelease,
        userDataDir: '/tmp/data',
        chromeExecutable: '/usr/bin/chrome',
      });

      const result = await acquirePlaywrightBrowserEngine();
      engine = result.engine;
    });

    it('snapshot() delegates to bridge', async () => {
      const snap = await engine.snapshot();
      expect(mockBridge.snapshot).toHaveBeenCalledOnce();
      expect(snap).toEqual({
        url: 'https://example.com',
        title: 'Example',
        snapshot: '- heading "Example"',
      });
    });

    it('navigate() delegates to bridge', async () => {
      await engine.navigate('https://test.com');
      expect(mockBridge.navigate).toHaveBeenCalledWith('https://test.com');
    });

    it('click() delegates to bridge', async () => {
      await engine.click('#button');
      expect(mockBridge.click).toHaveBeenCalledWith('#button', undefined);
    });

    it('click() with frameId', async () => {
      await engine.click('#button', 'frame1');
      expect(mockBridge.click).toHaveBeenCalledWith('#button', 'frame1');
    });

    it('type() delegates to bridge', async () => {
      await engine.type('input', 'hello');
      expect(mockBridge.type).toHaveBeenCalledWith('input', 'hello', undefined);
    });

    it('type() with frameId', async () => {
      await engine.type('input', 'hello', 'frame1');
      expect(mockBridge.type).toHaveBeenCalledWith('input', 'hello', 'frame1');
    });

    it('pressKey() delegates to bridge', async () => {
      await engine.pressKey('Enter');
      expect(mockBridge.pressKey).toHaveBeenCalledWith('Enter');
    });

    it('evaluate() delegates to bridge and returns result', async () => {
      mockBridge.evaluate.mockResolvedValue('42');
      const result = await engine.evaluate('return 6 * 7');
      expect(mockBridge.evaluate).toHaveBeenCalledWith('return 6 * 7', undefined);
      expect(result).toBe('42');
    });

    it('screenshot() delegates to bridge and returns base64', async () => {
      mockBridge.screenshot.mockResolvedValue('base64data...');
      const result = await engine.screenshot();
      expect(mockBridge.screenshot).toHaveBeenCalledOnce();
      expect(result).toBe('base64data...');
    });

    it('uploadFile() delegates to bridge', async () => {
      await engine.uploadFile('input[type=file]', ['/tmp/a.txt', '/tmp/b.txt']);
      expect(mockBridge.uploadFile).toHaveBeenCalledWith('input[type=file]', ['/tmp/a.txt', '/tmp/b.txt'], undefined);
    });

    it('getPageInfo() returns url and title from snapshot', async () => {
      const info = await engine.getPageInfo();
      expect(info).toEqual({ url: 'https://example.com', title: 'Example' });
    });
  });

  describe('release', () => {
    it('closes bridge and calls original release', async () => {
      const { acquirePlaywrightPage } = await import('../playwright-cdp');
      vi.mocked(acquirePlaywrightPage).mockResolvedValue({
        page: {} as any,
        release: mockRelease,
        userDataDir: '/tmp/data',
        chromeExecutable: '/usr/bin/chrome',
      });

      const result = await acquirePlaywrightBrowserEngine();
      await result.release();

      expect(mockBridge.close).toHaveBeenCalledOnce();
      expect(mockRelease).toHaveBeenCalledOnce();
    });

    it('swallows errors from bridge close and release', async () => {
      mockBridge.close.mockResolvedValue(undefined);
      mockRelease.mockRejectedValue(new Error('release failed'));

      const { acquirePlaywrightPage } = await import('../playwright-cdp');
      vi.mocked(acquirePlaywrightPage).mockResolvedValue({
        page: {} as any,
        release: mockRelease,
        userDataDir: '/tmp/data',
        chromeExecutable: '/usr/bin/chrome',
      });

      const result = await acquirePlaywrightBrowserEngine();
      await expect(result.release()).resolves.toBeUndefined();
    });
  });
});

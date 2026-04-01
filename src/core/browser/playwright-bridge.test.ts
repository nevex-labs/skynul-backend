import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaywrightBridge } from './playwright-bridge';

function createMockPage(overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, (...args: unknown[]) => void>();

  const mockLocator = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    first: vi.fn().mockReturnThis(),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    elementHandle: vi.fn().mockResolvedValue(null),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
    ariaSnapshot: vi.fn().mockResolvedValue(''),
  };

  const mockFrame = {
    locator: vi.fn().mockReturnValue(mockLocator),
    evaluate: vi.fn().mockResolvedValue(''),
    name: vi.fn().mockReturnValue(''),
    url: vi.fn().mockReturnValue(''),
  };

  const page = {
    url: vi.fn().mockReturnValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Test Page'),
    goto: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
    bringToFront: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForEvent: vi.fn().mockRejectedValue(new Error('timeout')),
    locator: vi.fn().mockReturnValue(mockLocator),
    mainFrame: vi.fn().mockReturnValue(mockFrame),
    frames: vi.fn().mockReturnValue([mockFrame]),
    evaluate: vi.fn().mockResolvedValue(''),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(event, handler);
    }),
    ...overrides,
  };

  return { page, mockLocator, mockFrame, listeners };
}

describe('PlaywrightBridge', () => {
  let mockPage: ReturnType<typeof createMockPage>['page'];
  let bridge: PlaywrightBridge;

  beforeEach(() => {
    const mock = createMockPage();
    mockPage = mock.page;
    bridge = new PlaywrightBridge(mockPage as any);
  });

  describe('constructor', () => {
    it('tracks the initial page', () => {
      expect(mockPage.once).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('exposes rawPage', () => {
      expect(bridge.rawPage).toBe(mockPage);
    });
  });

  describe('setActivePage', () => {
    it('switches the active page', async () => {
      const mock2 = createMockPage();
      mock2.page.url.mockReturnValue('https://other.com');

      bridge.setActivePage(mock2.page as any);

      mock2.page.url.mockReturnValue('https://other.com');
      const info = await bridge.getPageInfo();
      expect(info.url).toBe('https://other.com');
    });

    it('tracks new page and listens for close', () => {
      const mock2 = createMockPage();
      bridge.setActivePage(mock2.page as any);
      expect(mock2.page.once).toHaveBeenCalledWith('close', expect.any(Function));
    });
  });

  describe('close', () => {
    it('closes all owned pages', async () => {
      await bridge.close();
      expect(mockPage.close).toHaveBeenCalledOnce();
    });

    it('does not close already-closed pages', async () => {
      mockPage.isClosed.mockReturnValue(true);
      await bridge.close();
      expect(mockPage.close).not.toHaveBeenCalled();
    });

    it('swallows errors during close', async () => {
      mockPage.close.mockRejectedValue(new Error('already closed'));
      await expect(bridge.close()).resolves.toBeUndefined();
    });

    it('closes multiple pages (including popups)', async () => {
      const mock2 = createMockPage();
      bridge.setActivePage(mock2.page as any);

      await bridge.close();
      expect(mockPage.close).toHaveBeenCalledOnce();
      expect(mock2.page.close).toHaveBeenCalledOnce();
    });
  });

  describe('navigate', () => {
    it('calls page.goto with domcontentloaded and 60s timeout', async () => {
      await bridge.navigate('https://test.com');
      expect(mockPage.goto).toHaveBeenCalledWith('https://test.com', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
    });
  });

  describe('click', () => {
    it('resolves CSS selector via locator.first()', async () => {
      await bridge.click('#my-button');
      expect(mockPage.locator).toHaveBeenCalledWith('#my-button');
    });

    it('resolves aria-ref pattern via aria-ref locator', async () => {
      await bridge.click('e5');
      expect(mockPage.locator).toHaveBeenCalledWith('aria-ref=e5');
    });

    it('resolves aria-ref with iframe prefix', async () => {
      await bridge.click('f1e3');
      expect(mockPage.locator).toHaveBeenCalledWith('aria-ref=f1e3');
    });

    it('uses frame when frameId is provided', async () => {
      const mockFrame = {
        locator: vi.fn().mockReturnValue({
          first: vi.fn().mockReturnValue({
            click: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        name: vi.fn().mockReturnValue('my-frame'),
        url: vi.fn().mockReturnValue('https://iframe.com'),
        evaluate: vi.fn(),
      };
      mockPage.frames.mockReturnValue([mockPage.mainFrame(), mockFrame]);

      await bridge.click('#btn', 'my-frame');
      expect(mockFrame.locator).toHaveBeenCalledWith('#btn');
    });

    it('falls back to force click when element is outside viewport', async () => {
      const mockLoc = {
        click: vi.fn().mockRejectedValueOnce(new Error('outside of the viewport')),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        first: vi.fn().mockReturnThis(),
      };
      mockLoc.click.mockResolvedValueOnce(undefined);
      mockPage.locator.mockReturnValue(mockLoc);

      await bridge.click('#hidden-btn');
      expect(mockLoc.scrollIntoViewIfNeeded).toHaveBeenCalled();
      expect(mockLoc.click).toHaveBeenCalledTimes(2);
      expect(mockLoc.click).toHaveBeenLastCalledWith({ timeout: 5_000, force: true });
    });

    it('uses elementHandle evaluate as last resort', async () => {
      const mockHandle = {
        evaluate: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      };
      const mockLoc = {
        click: vi.fn().mockRejectedValueOnce(new Error('not visible')),
        first: vi.fn().mockReturnThis(),
        scrollIntoViewIfNeeded: vi.fn().mockRejectedValue(new Error('fail')),
        elementHandle: vi.fn().mockResolvedValue(mockHandle),
      };
      mockLoc.click.mockRejectedValueOnce(new Error('force failed'));
      mockPage.locator.mockReturnValue(mockLoc);

      await bridge.click('#stubborn-btn');
      expect(mockHandle.evaluate).toHaveBeenCalledWith(expect.any(Function));
      expect(mockHandle.dispose).toHaveBeenCalled();
    });

    it('re-throws non-visibility errors', async () => {
      const mockLoc = {
        click: vi.fn().mockRejectedValue(new Error('Navigation failed')),
        first: vi.fn().mockReturnThis(),
      };
      mockPage.locator.mockReturnValue(mockLoc);

      await expect(bridge.click('#btn')).rejects.toThrow('Navigation failed');
    });

    it('switches active page when popup opens', async () => {
      const mockPopup = createMockPage();
      mockPopup.page.url.mockReturnValue('https://popup.com');
      mockPopup.page.isClosed.mockReturnValue(false);

      mockPage.waitForEvent.mockResolvedValue(mockPopup.page);

      await bridge.click('#opens-popup');

      expect(mockPopup.page.bringToFront).toHaveBeenCalled();
      expect(mockPopup.page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 15_000 });

      const info = await bridge.getPageInfo();
      expect(info.url).toBe('https://popup.com');
    });
  });

  describe('type', () => {
    it('fills the input field', async () => {
      await bridge.type('input[name=email]', 'test@example.com');
      expect(mockPage.locator).toHaveBeenCalledWith('input[name=email]');
    });

    it('falls back to keyboard.type for contenteditable', async () => {
      const mockLoc = {
        fill: vi.fn().mockRejectedValue(new Error('not an input')),
        click: vi.fn().mockResolvedValue(undefined),
        first: vi.fn().mockReturnThis(),
      };
      mockPage.locator.mockReturnValue(mockLoc);

      await bridge.type('[contenteditable]', 'hello');
      expect(mockLoc.click).toHaveBeenCalled();
      expect(mockPage.keyboard.type).toHaveBeenCalledWith('hello', { delay: 5 });
    });

    it('uses force click + keyboard.type when fill and normal click fail', async () => {
      const mockHandle = {
        evaluate: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      };
      const mockLoc = {
        fill: vi.fn().mockRejectedValue(new Error('fail')),
        click: vi.fn().mockRejectedValueOnce(new Error('not visible')).mockRejectedValueOnce(new Error('force fail')),
        first: vi.fn().mockReturnThis(),
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        elementHandle: vi.fn().mockResolvedValue(mockHandle),
      };
      mockPage.locator.mockReturnValue(mockLoc);

      await bridge.type('#editor', 'text');
      expect(mockHandle.evaluate).toHaveBeenCalled();
      expect(mockHandle.dispose).toHaveBeenCalled();
      expect(mockPage.keyboard.type).toHaveBeenCalledWith('text', { delay: 5 });
    });
  });

  describe('pressKey', () => {
    it('delegates to page.keyboard.press', async () => {
      await bridge.pressKey('Enter');
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter');
    });
  });

  describe('evaluate', () => {
    it('evaluates simple expression', async () => {
      const mockFrame = mockPage.mainFrame();
      mockFrame.evaluate.mockResolvedValue(42);

      const result = await bridge.evaluate('6 * 7');
      expect(result).toBe('42');
    });

    it('wraps scripts with return in IIFE', async () => {
      const mockFrame = mockPage.mainFrame();
      mockFrame.evaluate.mockResolvedValue('hello');

      await bridge.evaluate('const x = 1;\nreturn x');
      expect(mockFrame.evaluate).toHaveBeenCalledWith(expect.any(Function), expect.stringContaining('(function(){'));
    });

    it('returns string as-is', async () => {
      const mockFrame = mockPage.mainFrame();
      mockFrame.evaluate.mockResolvedValue('raw string');

      const result = await bridge.evaluate('"raw string"');
      expect(result).toBe('raw string');
    });

    it('JSON.stringifies non-string results', async () => {
      const mockFrame = mockPage.mainFrame();
      mockFrame.evaluate.mockResolvedValue({ key: 'value' });

      const result = await bridge.evaluate('return {key: "value"}');
      expect(result).toBe('{"key":"value"}');
    });

    it('evaluates in specific frame', async () => {
      const mockFrame = {
        locator: vi.fn(),
        evaluate: vi.fn().mockResolvedValue('frame result'),
        name: vi.fn().mockReturnValue('my-frame'),
        url: vi.fn().mockReturnValue('https://iframe.com'),
      };
      mockPage.frames.mockReturnValue([mockPage.mainFrame(), mockFrame]);

      const result = await bridge.evaluate('document.title', 'my-frame');
      expect(mockFrame.evaluate).toHaveBeenCalled();
      expect(result).toBe('frame result');
    });
  });

  describe('screenshot', () => {
    it('returns base64 encoded PNG', async () => {
      mockPage.screenshot.mockResolvedValue(Buffer.from('fake-image-data'));

      const result = await bridge.screenshot();
      expect(mockPage.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: false });
      expect(result).toBe(Buffer.from('fake-image-data').toString('base64'));
    });
  });

  describe('uploadFile', () => {
    it('sets input files on the locator', async () => {
      const mockLoc = {
        setInputFiles: vi.fn().mockResolvedValue(undefined),
        first: vi.fn().mockReturnThis(),
      };
      mockPage.locator.mockReturnValue(mockLoc);

      await bridge.uploadFile('input[type=file]', ['/tmp/a.txt', '/tmp/b.txt']);
      expect(mockLoc.setInputFiles).toHaveBeenCalledWith(['/tmp/a.txt', '/tmp/b.txt']);
    });
  });

  describe('snapshot', () => {
    it('uses _snapshotForAI when available', async () => {
      const mockSnap = {
        url: 'https://example.com',
        title: 'Test',
        snapshot: '- heading "Test" [ref=e1]\n- link "Home" [ref=e2]',
      };

      const enrichedPage = mockPage as any;
      enrichedPage._snapshotForAI = vi.fn().mockResolvedValue({
        full: '- heading "Test" [ref=e1]\n- link "Home" [ref=e2]',
      });

      const bridgeWithSnap = new PlaywrightBridge(enrichedPage);
      const result = await bridgeWithSnap.snapshot();

      expect(enrichedPage._snapshotForAI).toHaveBeenCalled();
      expect(result.url).toBe('https://example.com');
      expect(result.title).toBe('Test Page');
      expect(result.snapshot).toContain('[ref=e1]');
    });

    it('falls back to ariaSnapshot when _snapshotForAI unavailable', async () => {
      const mockLoc = mockPage.locator('body');
      mockLoc.ariaSnapshot = vi.fn().mockResolvedValue('- heading "Fallback" [ref=e1]\n- link "Nav" [ref=e2]');

      const result = await bridge.snapshot();
      expect(mockLoc.ariaSnapshot).toHaveBeenCalled();
      expect(result.snapshot).toContain('heading');
    });

    it('falls back to DOM text when both snapshot methods fail', async () => {
      mockPage.evaluate.mockResolvedValue('button Submit\nlink Home');

      const result = await bridge.snapshot();
      expect(result.url).toBe('https://example.com');
      expect(result.title).toBe('Test Page');
      expect(result.snapshot).toContain('Submit');
    });

    it('truncates long snapshots with headTail', async () => {
      const longText = 'x'.repeat(10_000);
      mockPage.evaluate.mockResolvedValue(longText);

      const result = await bridge.snapshot();
      expect(result.snapshot.length).toBeLessThan(9_000);
      expect(result.snapshot).toContain('chars omitted');
    });
  });

  describe('getPageInfo', () => {
    it('returns url, title, text, and elements', async () => {
      mockPage.evaluate.mockResolvedValueOnce('Page body text content').mockResolvedValueOnce([
        { tag: 'button', selector: 'button', text: 'Click me', interactive: true },
        { tag: 'a', selector: 'a', text: 'Link', interactive: true },
      ]);

      const info = await bridge.getPageInfo();
      expect(info.url).toBe('https://example.com');
      expect(info.title).toBe('Test Page');
      expect(info.text).toBe('Page body text content');
      expect(info.elements).toHaveLength(2);
      expect(info.elements[0].tag).toBe('button');
    });

    it('handles evaluate errors gracefully', async () => {
      mockPage.evaluate.mockRejectedValue(new Error('eval failed'));

      const info = await bridge.getPageInfo();
      expect(info.url).toBe('https://example.com');
      expect(info.text).toBe('');
      expect(info.elements).toEqual([]);
    });

    it('uses specific frame when frameId provided', async () => {
      const mockFrame = {
        locator: vi.fn(),
        evaluate: vi.fn().mockResolvedValue('frame text'),
        name: vi.fn().mockReturnValue('my-frame'),
        url: vi.fn().mockReturnValue('https://iframe.com'),
      };
      mockPage.frames.mockReturnValue([mockPage.mainFrame(), mockFrame]);
      mockPage.evaluate.mockResolvedValueOnce('main text').mockResolvedValueOnce([]);

      const info = await bridge.getPageInfo();
      expect(info.text).toBe('main text');
    });
  });
});

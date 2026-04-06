import { PlaywrightBridge } from '../../core/browser/playwright-bridge';
import { acquirePlaywrightPage } from '../../core/browser/playwright-cdp';
import type { AcquiredBrowserEngine, BrowserEngine, BrowserPageInfo, BrowserSnapshot } from './browser-engine';

class PlaywrightBrowserEngine implements BrowserEngine {
  constructor(private bridge: PlaywrightBridge) {}

  snapshot = async (): Promise<BrowserSnapshot> => {
    return this.bridge.snapshot();
  };

  navigate = async (url: string): Promise<void> => {
    await this.bridge.navigate(url);
  };

  click = async (selector: string, frameId?: string): Promise<void> => {
    await this.bridge.click(selector, frameId);
  };

  type = async (selector: string, text: string, frameId?: string): Promise<void> => {
    await this.bridge.type(selector, text, frameId);
  };

  pressKey = async (key: string): Promise<void> => {
    await this.bridge.pressKey(key);
  };

  evaluate = async (script: string, frameId?: string): Promise<string> => {
    return this.bridge.evaluate(script, frameId);
  };

  uploadFile = async (selector: string, filePaths: string[], frameId?: string): Promise<void> => {
    await this.bridge.uploadFile(selector, filePaths, frameId);
  };

  screenshot = async (): Promise<string> => {
    return this.bridge.screenshot();
  };

  getPageInfo = async (_frameId?: string): Promise<BrowserPageInfo> => {
    const snap = await this.bridge.snapshot();
    return { url: snap.url, title: snap.title };
  };
}

export async function acquireBrowserEngine(): Promise<AcquiredBrowserEngine> {
  const acquired = await acquirePlaywrightPage();
  const bridge = new PlaywrightBridge(acquired.page);

  const release = async (): Promise<void> => {
    await bridge.close().catch(() => {});
    await acquired.release().catch(() => {});
  };

  return {
    engine: new PlaywrightBrowserEngine(bridge),
    release,
    meta: {
      chromeExecutable: acquired.chromeExecutable,
      userDataDir: acquired.userDataDir,
    },
  };
}

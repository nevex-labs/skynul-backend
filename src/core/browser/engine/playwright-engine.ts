import { PlaywrightBridge } from '../playwright-bridge';
import { acquirePlaywrightPage } from '../playwright-cdp';
import type { BrowserEngine } from './browser-engine';
import {
  type AcquiredBrowserEngine,
  BROWSER_ENGINE_ID,
  type BrowserPageInfo,
  type BrowserSnapshot,
} from './browser-engine';

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

  keyboardType = async (text: string): Promise<void> => {
    await this.bridge.keyboardType(text);
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

  getPageInfo = async (frameId?: string): Promise<BrowserPageInfo> => {
    void frameId;
    // We intentionally return minimal info as part of the stable port.
    // Engine adapters may have richer primitives internally.
    const snap = await this.bridge.snapshot();
    return { url: snap.url, title: snap.title };
  };
}

export async function acquirePlaywrightBrowserEngine(): Promise<AcquiredBrowserEngine> {
  const acquired = await acquirePlaywrightPage();
  const bridge = new PlaywrightBridge(acquired.page);

  const release = async (): Promise<void> => {
    // Close any popups/new tabs this task opened.
    await bridge.close().catch(() => {});
    // Back-compat: also call the original release.
    await acquired.release().catch(() => {});
  };

  return {
    engineId: BROWSER_ENGINE_ID.PLAYWRIGHT,
    engine: new PlaywrightBrowserEngine(bridge),
    release,
    meta: {
      chromeExecutable: acquired.chromeExecutable,
      userDataDir: acquired.userDataDir,
    },
  };
}

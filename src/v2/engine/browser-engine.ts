/**
 * Browser Engine — v2
 *
 * Stable port for browser automation.
 * Copied from old code, no dependencies on old code.
 */

export type BrowserSnapshot = {
  url: string;
  title: string;
  snapshot: string;
};

export type BrowserPageInfo = {
  url: string;
  title: string;
};

export interface BrowserEngine {
  snapshot: () => Promise<BrowserSnapshot>;
  navigate: (url: string) => Promise<void>;
  click: (selector: string, frameId?: string) => Promise<void>;
  type: (selector: string, text: string, frameId?: string) => Promise<void>;
  pressKey: (key: string) => Promise<void>;
  evaluate: (script: string, frameId?: string) => Promise<string>;
  uploadFile: (selector: string, filePaths: string[], frameId?: string) => Promise<void>;
  screenshot: () => Promise<string>;
  getPageInfo: (frameId?: string) => Promise<BrowserPageInfo>;
}

export type AcquiredBrowserEngine = {
  engine: BrowserEngine;
  release: () => Promise<void>;
  meta?: Record<string, string>;
};

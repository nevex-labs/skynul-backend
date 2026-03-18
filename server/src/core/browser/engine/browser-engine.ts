export const BROWSER_ENGINE_ID = {
  PLAYWRIGHT: 'playwright'
} as const

export type BrowserEngineId = (typeof BROWSER_ENGINE_ID)[keyof typeof BROWSER_ENGINE_ID]

export type BrowserSnapshot = {
  url: string
  title: string
  snapshot: string
}

export type BrowserPageInfo = {
  url: string
  title: string
}

export type AcquiredBrowserEngine = {
  engineId: BrowserEngineId
  engine: BrowserEngine
  release: () => Promise<void>
  meta?: Record<string, string>
}

/**
 * BrowserEngine is a stable port for browser automation.
 * TaskRunner must depend on this interface, not on Playwright types.
 */
export interface BrowserEngine {
  snapshot: () => Promise<BrowserSnapshot>
  navigate: (url: string) => Promise<void>
  click: (selector: string, frameId?: string) => Promise<void>
  type: (selector: string, text: string, frameId?: string) => Promise<void>
  pressKey: (key: string) => Promise<void>
  evaluate: (script: string, frameId?: string) => Promise<string>
  uploadFile: (selector: string, filePaths: string[], frameId?: string) => Promise<void>
  screenshot: () => Promise<string>
  getPageInfo: (frameId?: string) => Promise<BrowserPageInfo>
}

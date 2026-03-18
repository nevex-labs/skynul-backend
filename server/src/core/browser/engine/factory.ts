import { type AcquiredBrowserEngine, BROWSER_ENGINE_ID } from './browser-engine'
import { acquirePlaywrightBrowserEngine } from './playwright-engine'

function normalizeEngineId(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase()
}

export async function acquireBrowserEngine(): Promise<AcquiredBrowserEngine> {
  const requested = normalizeEngineId(process.env.SKYNUL_BROWSER_ENGINE)

  // Default adapter only, for now.
  if (!requested || requested === BROWSER_ENGINE_ID.PLAYWRIGHT) {
    return acquirePlaywrightBrowserEngine()
  }

  // Unknown engine ID → warn and fallback to Playwright.
  // This keeps the app working even if users set a placeholder env var.
  console.warn(
    `Unknown SKYNUL_BROWSER_ENGINE="${requested}"; falling back to "${BROWSER_ENGINE_ID.PLAYWRIGHT}"`
  )
  return acquirePlaywrightBrowserEngine()
}

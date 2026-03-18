/**
 * Web scraper — headless Chromium via playwright-core.
 * Uses system Chrome on Windows (detected via registry or fallback path).
 * Singleton browser instance reused across calls.
 */

import { execSync } from 'child_process'
import { type Browser, chromium } from 'playwright-core'

const MAX_TEXT_LENGTH = 16000
const PAGE_TIMEOUT_MS = 30_000

let browserInstance: Browser | null = null
let chromePath: string | null = null

const IS_WSL = process.platform === 'linux' && !!process.env.WSL_DISTRO_NAME

/**
 * Convert a Windows path (C:\foo\bar) to WSL path (/mnt/c/foo/bar).
 * Only converts when running inside WSL — on native Windows returns as-is.
 */
function toLocalPath(winPath: string): string {
  if (!IS_WSL) return winPath
  const normalized = winPath.replace(/\\/g, '/')
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/)
  if (match) {
    return `/mnt/${match[1].toLowerCase()}/${match[2]}`
  }
  return winPath
}

/** Detect the Chrome/Edge executable on the Windows host, return WSL-accessible path. */
function findChromePath(): string {
  if (chromePath) return chromePath

  // Try Chrome via registry
  try {
    const raw = execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe' -ErrorAction SilentlyContinue).'(Default)'"`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim()
    if (raw && raw.length > 0) {
      chromePath = toLocalPath(raw)
      return chromePath
    }
  } catch {
    // try Edge
  }

  // Try Edge via registry
  try {
    const raw = execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe' -ErrorAction SilentlyContinue).'(Default)'"`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim()
    if (raw && raw.length > 0) {
      chromePath = toLocalPath(raw)
      return chromePath
    }
  } catch {
    // fallback
  }

  // Hardcoded fallbacks (Windows paths, converted if on WSL)
  const fallbacks = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].map(toLocalPath)

  for (const fb of fallbacks) {
    try {
      if (IS_WSL) {
        execSync(`test -f "${fb}"`, { timeout: 2000 })
      } else {
        execSync(`if exist "${fb.replace(/\//g, '\\')}" (echo ok)`, { timeout: 2000 })
      }
      chromePath = fb
      return chromePath
    } catch {
      // try next
    }
  }

  // Last resort — return first fallback and let playwright give a clear error
  chromePath = fallbacks[0]
  return chromePath
}

const STEALTH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-infobars',
  '--headless=new',
  '--hide-scrollbars',
  '--mute-audio'
]

async function getBrowser(): Promise<Browser> {
  if (browserInstance?.isConnected()) return browserInstance

  if (IS_WSL) {
    // WSL: use Playwright's bundled Chromium (Linux binary) — no cross-boundary issues
    browserInstance = await chromium.launch({
      headless: true,
      args: STEALTH_ARGS
    })
  } else {
    // Native Windows: use system Chrome
    const executablePath = findChromePath()
    browserInstance = await chromium.launch({
      executablePath,
      headless: true,
      args: STEALTH_ARGS
    })
  }

  browserInstance.on('disconnected', () => {
    browserInstance = null
  })

  return browserInstance
}

/**
 * Scrape a URL and return the visible text content.
 * @param url - The URL to scrape.
 * @param instruction - What to extract (currently unused — returns full visible text).
 */
export async function scrapeUrl(url: string, _instruction: string): Promise<string> {
  // Fast path: API URLs → fetch JSON directly, no browser needed
  if (
    url.includes('api.mercadolibre.com') ||
    url.includes('/api/') ||
    url.match(/\.(json)(\?|$)/)
  ) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
      })
      const text = await res.text()
      if (text.length > MAX_TEXT_LENGTH)
        return text.slice(0, MAX_TEXT_LENGTH) + '\n\n[... truncated]'
      return text || '[Empty API response]'
    } catch (e) {
      return `[API fetch error: ${e instanceof Error ? e.message : String(e)}]`
    }
  }

  const browser = await getBrowser()
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    }
  })
  const page = await context.newPage()

  // Stealth: evade common anti-bot checks
  await page.addInitScript(() => {
    // 1. Remove webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })

    // 2. Fake chrome runtime (headless doesn't have it)
    if (!(window as any).chrome) {
      ;(window as any).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) }
    }

    // 3. Realistic plugins array
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = [
          {
            name: 'Chrome PDF Plugin',
            filename: 'internal-pdf-viewer',
            description: 'Portable Document Format'
          },
          {
            name: 'Chrome PDF Viewer',
            filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
            description: ''
          },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
        ]
        Object.defineProperty(arr, 'length', { value: 3 })
        return arr
      }
    })

    // 4. Languages
    Object.defineProperty(navigator, 'languages', { get: () => ['es-AR', 'es', 'en'] })

    // 5. Permissions API — pretend notifications are "denied" like a real browser
    const origQuery = (
      navigator.permissions?.query || (() => Promise.resolve({ state: 'denied' }))
    ).bind(navigator.permissions)
    if (navigator.permissions) {
      navigator.permissions.query = (params: any) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: 'denied', onchange: null } as any)
          : origQuery(params)
    }
  })

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS })

    // Wait for JS-rendered content (Maps, Airbnb, etc. need extra time)
    try {
      await page.waitForFunction(() => (document.body?.innerText?.length ?? 0) > 500, {
        timeout: 10_000
      })
    } catch {
      // fallback — page may just be light on text
    }
    await page.waitForTimeout(3000)

    // Google Maps: scroll feed + extract structured listings
    const isGoogleMaps = url.includes('google.com/maps')
    if (isGoogleMaps) {
      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => {
          const feed = document.querySelector('div[role="feed"]')
          if (feed) feed.scrollTop = feed.scrollHeight
        })
        await page.waitForTimeout(2000)
      }

      // Parse listings into structured data
      const listings = await page.evaluate(() => {
        const results: Array<{
          name: string
          rating: string
          address: string
          hasWebsite: boolean
          category: string
        }> = []
        const cards = document.querySelectorAll('div[role="feed"] > div')
        for (const card of cards) {
          const nameEl = card.querySelector('div.fontHeadlineSmall, a[aria-label]')
          const name =
            nameEl?.textContent?.trim() ||
            (nameEl as HTMLElement)?.getAttribute('aria-label')?.trim() ||
            ''
          if (!name || name.length < 2) continue

          const text = (card as HTMLElement).innerText || ''
          const ratingMatch = text.match(/(\d[.,]\d)\s*\(/)
          const rating = ratingMatch ? ratingMatch[1].replace(',', '.') : ''

          // Address: line after category, contains numbers or known street words
          const lines = text
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
          let address = ''
          let category = ''
          for (const line of lines) {
            if (/^\d[.,]\d/.test(line)) continue // skip rating line
            if (line === name) continue
            if (
              /Abierto|Cerrado|Cierra|Vuelve|Compras en tienda|Retiro|Entrega|Patrocinado/i.test(
                line
              )
            )
              continue
            if (/^"/.test(line)) continue // skip reviews
            if (/·/.test(line) && !category) {
              const parts = line
                .split('·')
                .map((p) => p.trim())
                .filter(Boolean)
              for (const part of parts) {
                if (/\d/.test(part) && /[A-Za-záéíóú]/.test(part)) address = part
                else if (!category && part.length > 2) category = part
              }
              continue
            }
            if (!address && /\d/.test(line) && line.length > 5) address = line
          }

          // Check if card has a website link
          const hasWebsite =
            !!card.querySelector(
              'a[data-value="Website"], a[href*="website"], a[data-tooltip="Open website"]'
            ) ||
            text.includes('Sitio web') ||
            text.includes('Visitar sitio')

          const r = parseFloat(rating)
          if (rating && r >= 3.0 && r <= 5.0) {
            results.push({ name, rating, address, hasWebsite, category })
          }
        }
        return results
      })

      if (listings.length > 0) {
        const header = 'Nombre\tDirección\tCalificación\tCategoría\tTiene Sitio Web'
        const rows = listings.map(
          (l) =>
            `${l.name}\t${l.address || 'Sin dirección'}\t${l.rating}\t${l.category}\t${l.hasWebsite ? 'Sí' : 'No'}`
        )
        return `${header}\n${rows.join('\n')}\n\nTotal: ${listings.length} negocios con 3-5 estrellas. Sin sitio web: ${listings.filter((l) => !l.hasWebsite).length}.`
      }
    }

    // Fallback: extract visible text for non-Maps sites
    const text = await page.evaluate(() => {
      return document.body?.innerText ?? ''
    })

    const trimmed = text.trim()
    if (trimmed.length === 0) {
      return '[No visible text content on this page]'
    }

    if (trimmed.length > MAX_TEXT_LENGTH) {
      return trimmed.slice(0, MAX_TEXT_LENGTH) + '\n\n[... truncated]'
    }

    return trimmed
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return `[Scrape error: ${msg}]`
  } finally {
    await context.close().catch(() => {})
  }
}

/** Shut down the singleton browser (call on app quit). */
export async function closeScraper(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {})
    browserInstance = null
  }
}

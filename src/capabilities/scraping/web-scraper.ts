/**
 * Web scraper — headless Chromium via playwright-core.
 * Uses system Chrome on Windows (detected via registry or fallback path).
 * Singleton browser instance reused across calls.
 */

import { execSync } from 'child_process';
import { type Browser, chromium } from 'playwright-core';
import { validateUrl } from '../../core/util/input-guard';

const MAX_TEXT_LENGTH = 16000;
const PAGE_TIMEOUT_MS = 30_000;

let browserInstance: Browser | null = null;
let chromePath: string | null = null;
let browserLock: Promise<Browser> | null = null;

const IS_WSL = process.platform === 'linux' && !!process.env.WSL_DISTRO_NAME;

/**
 * Convert a Windows path (C:\foo\bar) to WSL path (/mnt/c/foo/bar).
 * Only converts when running inside WSL — on native Windows returns as-is.
 */
function toLocalPath(winPath: string): string {
  if (!IS_WSL) return winPath;
  const normalized = winPath.replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (match) {
    return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
  }
  return winPath;
}

function tryGetRegistryExe(regKey: string): string | null {
  try {
    const raw = execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "(Get-ItemProperty '${regKey}' -ErrorAction SilentlyContinue).'(Default)'"`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    if (raw && raw.length > 0) return toLocalPath(raw);
  } catch {}
  return null;
}

function tryFallbackPaths(fallbacks: string[]): string | null {
  for (const fb of fallbacks) {
    try {
      if (IS_WSL) {
        execSync(`test -f "${fb}"`, { timeout: 2000 });
      } else {
        execSync(`if exist "${fb.replace(/\//g, '\\')}" (echo ok)`, { timeout: 2000 });
      }
      return fb;
    } catch {}
  }
  return null;
}

/** Detect the Chrome/Edge executable on the Windows host, return WSL-accessible path. */
function findChromePath(): string {
  if (chromePath) return chromePath;
  const chrome = tryGetRegistryExe('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe');
  if (chrome) {
    chromePath = chrome;
    return chromePath;
  }
  const edge = tryGetRegistryExe('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe');
  if (edge) {
    chromePath = edge;
    return chromePath;
  }
  const fallbacks = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].map(toLocalPath);
  chromePath = tryFallbackPaths(fallbacks) ?? fallbacks[0];
  return chromePath;
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
  '--mute-audio',
];

async function getBrowser(): Promise<Browser> {
  if (browserInstance?.isConnected()) return browserInstance;

  // If another call is already launching, wait for it.
  // JS is single-threaded so this assignment is atomic — concurrent callers
  // will always see the lock set before any `await` yields.
  if (browserLock) return browserLock;

  // Create the promise synchronously so the lock is visible immediately.
  browserLock = (async () => {
    try {
      if (browserInstance?.isConnected()) return browserInstance;

      if (IS_WSL) {
        browserInstance = await chromium.launch({
          headless: true,
          args: STEALTH_ARGS,
        });
      } else {
        const executablePath = findChromePath();
        browserInstance = await chromium.launch({
          executablePath,
          headless: true,
          args: STEALTH_ARGS,
        });
      }

      browserInstance?.on('disconnected', () => {
        browserInstance = null;
      });

      if (!browserInstance) throw new Error('Browser instance failed to initialize');
      return browserInstance;
    } finally {
      browserLock = null;
    }
  })();

  return browserLock;
}

function isApiLikeUrl(url: string): boolean {
  return Boolean(url.includes('api.mercadolibre.com') || url.includes('/api/') || url.match(/\.(json)(\?|$)/));
}

function truncateText(text: string): string {
  if (text.length > MAX_TEXT_LENGTH) return `${text.slice(0, MAX_TEXT_LENGTH)}\n\n[... truncated]`;
  return text;
}

async function scrapeApiUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    const text = await res.text();
    return text ? truncateText(text) : '[Empty API response]';
  } catch (e) {
    return `[API fetch error: ${e instanceof Error ? e.message : String(e)}]`;
  }
}

function setupStealthScript(): void {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  if (!(window as any).chrome) {
    (window as any).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  }

  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const arr = [
        {
          name: 'Chrome PDF Plugin',
          filename: 'internal-pdf-viewer',
          description: 'Portable Document Format',
        },
        {
          name: 'Chrome PDF Viewer',
          filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
          description: '',
        },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      Object.defineProperty(arr, 'length', { value: 3 });
      return arr;
    },
  });

  Object.defineProperty(navigator, 'languages', { get: () => ['es-AR', 'es', 'en'] });

  const origQuery = (navigator.permissions?.query || (() => Promise.resolve({ state: 'denied' }))).bind(
    navigator.permissions
  );
  if (navigator.permissions) {
    navigator.permissions.query = (params: any) =>
      params.name === 'notifications' ? Promise.resolve({ state: 'denied', onchange: null } as any) : origQuery(params);
  }
}

async function waitForRenderedText(page: Awaited<ReturnType<Browser['newPage']>>): Promise<void> {
  try {
    await page.waitForFunction(() => (document.body?.innerText?.length ?? 0) > 500, {
      timeout: 10_000,
    });
  } catch {}
  await page.waitForTimeout(3000);
}

function shouldSkipMapsLine(line: string, name: string): boolean {
  if (/^\d[.,]\d/.test(line)) return true;
  if (line === name) return true;
  if (/Abierto|Cerrado|Cierra|Vuelve|Compras en tienda|Retiro|Entrega|Patrocinado/i.test(line)) return true;
  if (/^"/.test(line)) return true;
  return false;
}

function parseCategoryAddressParts(parts: string[]): { address: string; category: string } {
  let address = '';
  let category = '';
  for (const part of parts) {
    if (!address && /\d/.test(part) && /[A-Za-záéíóú]/.test(part)) address = part;
    else if (!category && part.length > 2) category = part;
  }
  return { address, category };
}

function parseMapsLine(line: string, name: string): { address: string; category: string } {
  if (shouldSkipMapsLine(line, name)) return { address: '', category: '' };
  if (line.includes('·')) {
    const parts = line
      .split('·')
      .map((p) => p.trim())
      .filter(Boolean);
    return parseCategoryAddressParts(parts);
  }
  if (/\d/.test(line) && line.length > 5) return { address: line, category: '' };
  return { address: '', category: '' };
}

function getCardName(card: Element): string {
  const nameEl = card.querySelector('div.fontHeadlineSmall, a[aria-label]');
  return nameEl?.textContent?.trim() || (nameEl as HTMLElement)?.getAttribute('aria-label')?.trim() || '';
}

function parseAddressAndCategory(text: string, name: string): { address: string; category: string } {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let address = '';
  let category = '';
  for (const line of lines) {
    const parsed = parseMapsLine(line, name);
    if (!address && parsed.address) address = parsed.address;
    if (!category && parsed.category) category = parsed.category;
  }
  return { address, category };
}

function parseGoogleMapsCard(card: Element): {
  name: string;
  rating: string;
  address: string;
  hasWebsite: boolean;
  category: string;
} | null {
  const name = getCardName(card);
  if (!name || name.length < 2) return null;

  const text = (card as HTMLElement).innerText || '';
  const ratingMatch = text.match(/(\d[.,]\d)\s*\(/);
  const rating = ratingMatch ? ratingMatch[1].replace(',', '.') : '';
  const { address, category } = parseAddressAndCategory(text, name);
  const hasWebsite =
    !!card.querySelector('a[data-value="Website"], a[href*="website"], a[data-tooltip="Open website"]') ||
    text.includes('Sitio web') ||
    text.includes('Visitar sitio');
  const r = Number.parseFloat(rating);
  if (!(rating && r >= 3.0 && r <= 5.0)) return null;
  return { name, rating, address, hasWebsite, category };
}

function extractGoogleMapsListingsInPage(): Array<{
  name: string;
  rating: string;
  address: string;
  hasWebsite: boolean;
  category: string;
}> {
  const results: Array<{
    name: string;
    rating: string;
    address: string;
    hasWebsite: boolean;
    category: string;
  }> = [];

  const cards = document.querySelectorAll('div[role="feed"] > div');
  for (const card of cards) {
    const parsed = parseGoogleMapsCard(card);
    if (parsed) results.push(parsed);
  }
  return results;
}

async function scrapeGoogleMaps(page: Awaited<ReturnType<Browser['newPage']>>): Promise<string | null> {
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) feed.scrollTop = feed.scrollHeight;
    });
    await page.waitForTimeout(2000);
  }

  const listings = await page.evaluate(extractGoogleMapsListingsInPage);
  if (listings.length === 0) return null;

  const header = 'Nombre\tDirección\tCalificación\tCategoría\tTiene Sitio Web';
  const rows = listings.map(
    (l) => `${l.name}\t${l.address || 'Sin dirección'}\t${l.rating}\t${l.category}\t${l.hasWebsite ? 'Sí' : 'No'}`
  );
  return `${header}\n${rows.join('\n')}\n\nTotal: ${listings.length} negocios con 3-5 estrellas. Sin sitio web: ${listings.filter((l) => !l.hasWebsite).length}.`;
}

async function scrapeVisibleText(page: Awaited<ReturnType<Browser['newPage']>>): Promise<string> {
  const text = await page.evaluate(() => document.body?.innerText ?? '');
  const trimmed = text.trim();
  if (trimmed.length === 0) return '[No visible text content on this page]';
  return truncateText(trimmed);
}

/**
 * Scrape a URL and return the visible text content.
 * @param url - The URL to scrape.
 * @param instruction - What to extract (currently unused — returns full visible text).
 */
export async function scrapeUrl(url: string, _instruction: string): Promise<string> {
  validateUrl(url);
  if (isApiLikeUrl(url)) return scrapeApiUrl(url);

  const browser = await getBrowser();
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
      'sec-ch-ua-platform': '"Windows"',
    },
  });
  const page = await context.newPage();

  await page.addInitScript(setupStealthScript);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });

    await waitForRenderedText(page);

    if (url.includes('google.com/maps')) {
      const mapsResult = await scrapeGoogleMaps(page);
      if (mapsResult) return mapsResult;
    }

    return scrapeVisibleText(page);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `[Scrape error: ${msg}]`;
  } finally {
    await context.close().catch(() => {});
  }
}

/** Shut down the singleton browser (call on app quit). */
export async function closeScraper(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

import type { Frame, Page } from 'playwright-core';

/** Strip unnamed structural lines whose children have no [ref=] markers. */
function compactSnapshot(snap: string): string {
  const lines = snap.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Keep lines that have a ref or visible text content (quoted names)
    if (line.includes('[ref=') || line.includes('"')) {
      out.push(line);
      continue;
    }
    // Keep structural lines only if a descendant has [ref=]
    const indent = line.search(/\S/);
    let hasUsefulChild = false;
    for (let j = i + 1; j < lines.length; j++) {
      const childIndent = lines[j].search(/\S/);
      if (childIndent <= indent) break;
      if (lines[j].includes('[ref=') || lines[j].includes('"')) {
        hasUsefulChild = true;
        break;
      }
    }
    if (hasUsefulChild) out.push(line);
  }
  return out.join('\n');
}

/** Keep head+tail of long text so the model sees both beginning and end. */
function headTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.6);
  const tail = limit - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n\n[... ${omitted} chars omitted ...]\n\n${text.slice(text.length - tail)}`;
}

type PageWithSnapshot = Page & {
  _snapshotForAI?: (opts?: {
    timeout?: number;
    track?: string;
  }) => Promise<{ full?: string }>;
};

export type PageInfo = {
  url: string;
  title: string;
  text: string;
  elements: Array<{
    tag: string;
    selector: string;
    text?: string;
    type?: string;
    interactive?: boolean;
  }>;
};

export class PlaywrightBridge {
  private ownedPages = new Set<Page>();

  constructor(private page: Page) {
    this.trackPage(page);
  }

  private trackPage(page: Page): void {
    this.ownedPages.add(page);
    page.once('close', () => {
      this.ownedPages.delete(page);
    });
  }

  /**
   * Switch the active page (e.g. when a click opens a new tab).
   * The rest of the engine intentionally operates on a single "active" page.
   */
  setActivePage(page: Page): void {
    if (!this.ownedPages.has(page)) this.trackPage(page);
    this.page = page;
  }

  /** Close all pages opened/used by this bridge. */
  async close(): Promise<void> {
    const pages = [...this.ownedPages];
    for (const p of pages) {
      try {
        if (!p.isClosed()) await p.close();
      } catch {
        // ignore
      }
    }
    this.ownedPages.clear();
  }

  get rawPage(): Page {
    return this.page;
  }

  /**
   * Resolve a locator — supports aria-ref IDs (e.g. "e5") and CSS selectors.
   * aria-ref works across iframes automatically.
   */
  private resolveLocator(selector: string, frameId?: string) {
    // aria-ref pattern from snapshot (e.g. "e5", "f1e1", "f2e12")
    if (/^(f\d+)?e\d+$/.test(selector)) {
      return this.page.locator(`aria-ref=${selector}`);
    }
    if (frameId) {
      const frame = this.resolveFrame(frameId);
      return frame.locator(selector).first();
    }
    return this.page.locator(selector).first();
  }

  private resolveFrame(frameId?: string): Frame {
    if (!frameId) return this.page.mainFrame();
    const frames = this.page.frames();
    const idx = Number(frameId);
    if (!Number.isNaN(idx) && idx >= 0 && idx < frames.length) return frames[idx];
    const match = frames.find((f) => f.name() === frameId || f.url().includes(frameId));
    return match ?? this.page.mainFrame();
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
  }

  async click(selector: string, frameId?: string): Promise<void> {
    // If the click opens a popup/new tab, switch the active page to it.
    // This avoids "Target page, context or browser has been closed" errors
    // when sites close the opener after opening a new tab.
    const popupPromise = this.page.waitForEvent('popup', { timeout: 1_500 }).catch(() => null);

    const loc = this.resolveLocator(selector, frameId);
    try {
      await loc.click({ timeout: 8_000 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (
        msg.includes('outside of the viewport') ||
        msg.includes('not visible') ||
        msg.includes('intercepts pointer events')
      ) {
        // Strategy 1: scroll into view + force click
        try {
          await loc.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
          await loc.click({ timeout: 5_000, force: true });
        } catch {
          // Strategy 2: JS-based focus + click via element handle (works for iframe elements)
          const handle = await loc.elementHandle({ timeout: 3_000 }).catch(() => null);
          if (handle) {
            await handle.evaluate((el) => {
              (el as HTMLElement).scrollIntoView({
                block: 'center',
                behavior: 'instant',
              });
              (el as HTMLElement).focus();
              (el as HTMLElement).click();
            });
            handle.dispose();
          } else {
            throw e;
          }
        }
      } else {
        throw e;
      }
    }

    const popup = await popupPromise;
    if (popup && !popup.isClosed()) {
      // eslint-disable-next-line no-console
      console.log('[browser] popup opened; switching active page');
      this.setActivePage(popup);
      await popup.bringToFront().catch(() => {});
      await popup.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    }
  }

  async type(selector: string, text: string, frameId?: string): Promise<void> {
    const loc = this.resolveLocator(selector, frameId);
    try {
      await loc.fill(text, { timeout: 8_000 });
    } catch {
      // Fallback for contenteditable / non-input elements
      // First try to focus the element so keyboard.type() lands in the right place
      let focused = false;
      try {
        await loc.click({ timeout: 5_000 });
        focused = true;
      } catch (clickErr) {
        const msg = clickErr instanceof Error ? clickErr.message : '';
        if (
          msg.includes('outside of the viewport') ||
          msg.includes('not visible') ||
          msg.includes('intercepts pointer events')
        ) {
          // Try scroll + force click
          try {
            await loc.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
            await loc.click({ timeout: 5_000, force: true });
            focused = true;
          } catch {
            // JS-based focus via element handle (reliable for iframe contenteditable)
            const handle = await loc.elementHandle({ timeout: 3_000 }).catch(() => null);
            if (handle) {
              await handle.evaluate((el) => {
                (el as HTMLElement).scrollIntoView({
                  block: 'center',
                  behavior: 'instant',
                });
                (el as HTMLElement).focus();
                // Place cursor at end for contenteditable
                if ((el as HTMLElement).getAttribute('contenteditable') === 'true') {
                  const range = document.createRange();
                  range.selectNodeContents(el);
                  range.collapse(false);
                  const sel = window.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }
              });
              handle.dispose();
              focused = true;
            }
          }
        }
        if (!focused) throw clickErr;
      }
      await this.page.keyboard.type(text, { delay: 5 });
    }
  }

  async pressKey(key: string): Promise<void> {
    // Normalize common key aliases that Playwright doesn't accept
    const normalized = key
      .replace(/\bCtrl\b/g, 'Control')
      .replace(/\bCmd\b/g, 'Meta')
      .replace(/\bOpt\b/g, 'Alt')
      .replace(/\bReturn\b/g, 'Enter')
      .replace(/\bDel\b/g, 'Delete');
    await this.page.keyboard.press(normalized);
  }

  async keyboardType(text: string): Promise<void> {
    await this.page.keyboard.type(text, { delay: 10 });
  }

  async evaluate(script: string, frameId?: string): Promise<string> {
    const frame = this.resolveFrame(frameId);
    // Wrap scripts containing `return` in an IIFE so they work with eval
    const expr = /^\s*return\s/m.test(script) ? `(function(){${script}})()` : script;
    const val = await frame.evaluate((code) => {
      // eslint-disable-next-line no-eval
      return (0, eval)(code);
    }, expr);
    return typeof val === 'string' ? val : JSON.stringify(val);
  }

  async screenshot(): Promise<string> {
    const buf = await this.page.screenshot({ type: 'png', fullPage: false });
    return buf.toString('base64');
  }

  async screenshotJpeg(quality = 40): Promise<Buffer> {
    return this.page.screenshot({ type: 'jpeg', quality, fullPage: false });
  }

  async uploadFile(selector: string, filePaths: string[], frameId?: string): Promise<void> {
    const loc = this.resolveLocator(selector, frameId);
    await loc.setInputFiles(filePaths);
  }

  /**
   * AI-optimized page snapshot using Playwright's _snapshotForAI.
   * Returns aria-ref IDs (e.g. e1, e5) that work across iframes.
   * Fallback to ariaSnapshot if _snapshotForAI is unavailable.
   */
  async snapshot(): Promise<{ url: string; title: string; snapshot: string }> {
    const url = this.page.url();
    const title = await this.page.title().catch(() => '');

    // Primary: _snapshotForAI — includes iframes, assigns aria-ref IDs
    const maybePage = this.page as PageWithSnapshot;
    if (maybePage._snapshotForAI) {
      try {
        const result = await maybePage._snapshotForAI({
          timeout: 10_000,
          track: 'response',
        });
        const snap = String(result?.full ?? '');
        if (snap.length > 20) {
          return {
            url,
            title,
            snapshot: headTail(compactSnapshot(snap), 8_000),
          };
        }
      } catch {
        // fallback below
      }
    }

    // Fallback: ariaSnapshot (no aria-ref IDs, no iframe content)
    try {
      const snap = await this.page.locator('body').ariaSnapshot({ timeout: 10_000 });
      if (snap && snap.length > 20) {
        return { url, title, snapshot: headTail(compactSnapshot(snap), 8_000) };
      }
    } catch {
      // fallback below
    }

    // Last resort: DOM text snapshot
    const text = await this.page
      .evaluate(() => {
        const lines: string[] = [];
        const walk = (el: Element, depth: number): void => {
          const tag = el.tagName?.toLowerCase() || '';
          const role = el.getAttribute('role') || '';
          const label =
            el.getAttribute('aria-label') || el.getAttribute('data-testid') || el.getAttribute('placeholder') || '';
          const innerText = (el as HTMLElement).innerText?.trim()?.slice(0, 80) || '';
          const isInteractive =
            /^(button|a|input|textarea|select)$/.test(tag) ||
            role === 'button' ||
            role === 'link' ||
            role === 'textbox' ||
            el.getAttribute('contenteditable') === 'true';
          if (isInteractive || (innerText && depth < 4)) {
            const indent = '  '.repeat(depth);
            const desc = [tag, role && `role=${role}`, label && `"${label}"`].filter(Boolean).join(' ');
            const textPart = innerText && !label.includes(innerText) ? `: ${innerText}` : '';
            lines.push(`${indent}${desc}${textPart}`);
          }
          if (lines.length < 200) {
            for (const child of el.children) walk(child, depth + 1);
          }
        };
        if (document.body) walk(document.body, 0);
        return lines.join('\n');
      })
      .catch(() => '');

    return { url, title, snapshot: headTail(text, 8_000) };
  }

  async getPageInfo(): Promise<PageInfo> {
    const url = this.page.url();
    const title = await this.page.title().catch(() => '');
    const text = (await this.page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '').catch(() => '')) || '';
    const elements =
      (await this.page
        .evaluate(() => {
          const els: Array<{
            tag: string;
            selector: string;
            text?: string;
            type?: string;
            interactive?: boolean;
          }> = [];
          const push = (el: Element): void => {
            const tag = (el as HTMLElement).tagName?.toLowerCase() || 'el';
            const t = (el as HTMLElement).innerText?.trim()?.slice(0, 60);
            let selector = tag;
            const dt = (el as HTMLElement).getAttribute?.('data-testid');
            if (dt) selector = `[data-testid="${dt}"]`;
            else if ((el as HTMLElement).id) selector = `#${(el as HTMLElement).id}`;
            else if ((el as HTMLElement).getAttribute?.('aria-label'))
              selector = `${tag}[aria-label="${(el as HTMLElement).getAttribute('aria-label')}"]`;
            els.push({
              tag,
              selector,
              text: t || undefined,
              interactive: true,
            });
          };
          document
            .querySelectorAll('button, a, input, textarea, [role="button"], [contenteditable="true"]')
            .forEach((el) => {
              if (els.length >= 30) return;
              push(el);
            });
          return els;
        })
        .catch(() => [])) || [];
    return { url, title, text, elements };
  }
}

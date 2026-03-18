import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'child_process'
import { constants as fsConstants } from 'fs'
import { access, cp, mkdir, readFile, readlink, stat, unlink, writeFile } from 'fs/promises'
import http from 'http'
import net from 'net'
import os from 'os'
import { dirname, join } from 'path'
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core'
import { getDataDir } from '../config'

const app = { getPath: (_: string) => getDataDir() }

type LaunchResult = {
  proc: ChildProcessWithoutNullStreams | null
  port: number
  browser: Browser
  context: BrowserContext
  userDataDir: string
  chromeExecutable: string
  close: () => Promise<void>
}

let shared: LaunchResult | null = null

async function readPreferredUserDataDir(): Promise<string | null> {
  try {
    const p = join(app.getPath('userData'), 'browser', 'chrome-user-data-selected.txt')
    const raw = (await readFile(p, 'utf8')).trim()
    return raw || null
  } catch {
    return null
  }
}

async function writePreferredUserDataDir(dir: string): Promise<void> {
  try {
    const p = join(app.getPath('userData'), 'browser', 'chrome-user-data-selected.txt')
    await mkdir(join(app.getPath('userData'), 'browser'), { recursive: true })
    await writeFile(p, `${dir}\n`, 'utf8')
  } catch {
    // ignore
  }
}

async function looksLikeChromeProfileDir(
  userDataDir: string,
  profileDirectory: string
): Promise<boolean> {
  try {
    if (await pathExists(join(userDataDir, 'Local State'))) return true
    if (await pathExists(join(userDataDir, profileDirectory, 'Preferences'))) return true
    return false
  } catch {
    return false
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    if (!s.isFile()) return false
    // On Windows it's always executable; on WSL, Windows .exe files are runnable even
    // when the drvfs mount doesn't expose executable bits.
    if (process.platform === 'win32') return true
    if (isWsl() && p.toLowerCase().endsWith('.exe') && p.startsWith('/mnt/')) return true
    await access(p, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function pickFreePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('Could not pick a free port')
  const port = addr.port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function httpGetJson(url: string, timeoutMs: number): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))))
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve(JSON.parse(body))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'))
    })
  })
}

async function waitForJsonVersion(host: string, port: number, timeoutMs: number): Promise<void> {
  const started = Date.now()
  const url = `http://${host}:${port}/json/version`
  while (Date.now() - started < timeoutMs) {
    try {
      await httpGetJson(url, 900)
      return
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(
    `Timed out waiting for Chrome remote debugging endpoint (timeout=${timeoutMs}ms). Tried: ${url}`
  )
}

async function whichExecutable(cmd: string): Promise<string | null> {
  const tool = process.platform === 'win32' ? 'where' : 'which'
  return await new Promise((resolve) => {
    execFile(tool, [cmd], (err: unknown, stdout?: string | Buffer) => {
      if (err) return resolve(null)
      const out = String(stdout ?? '')
      const first = out
        .split(/\r?\n/g)
        .map((s) => s.trim())
        .filter(Boolean)[0]
      resolve(first ?? null)
    })
  })
}

function isWsl(): boolean {
  if (process.platform !== 'linux') return false
  // Common WSL env vars; os.release() includes "microsoft" on WSL2.
  if (process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME) return true
  return os.release().toLowerCase().includes('microsoft')
}

async function resolveChromeExecutable(): Promise<string> {
  const fromEnvRaw = process.env.SKYNUL_CHROME_PATH
  const fromEnv = fromEnvRaw?.trim()
  if (fromEnv) {
    // Support either absolute path or a command in PATH.
    if (fromEnv.includes('/') || fromEnv.includes('\\') || fromEnv.endsWith('.exe')) {
      if (await isExecutable(fromEnv)) return fromEnv
      // Don't hard-fail on a bad env var; fallback to auto-detection.
      // This avoids breaking the app when a placeholder value is present.
      // eslint-disable-next-line no-console
      console.warn(
        `SKYNUL_CHROME_PATH points to a missing executable: ${fromEnv} (falling back to auto-detection)`
      )
    }
    const resolved = await whichExecutable(fromEnv)
    if (resolved) return resolved
    // eslint-disable-next-line no-console
    console.warn(
      `SKYNUL_CHROME_PATH was set but not found in PATH: ${fromEnv} (falling back to auto-detection)`
    )
  }

  const platform = process.platform

  const home = process.env.HOME

  const absoluteCandidates: string[] = []
  if (platform === 'linux') {
    absoluteCandidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/opt/google/chrome/chrome',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/usr/bin/brave-browser',
      '/usr/bin/vivaldi',
      '/usr/bin/vivaldi-stable'
    )

    // Skynul-managed user-space Chrome install (no sudo needed):
    // extracted from the official .deb to $HOME/.local/skynul-chrome.
    if (home) {
      absoluteCandidates.push(
        join(home, '.local', 'skynul-chrome', 'opt', 'google', 'chrome', 'google-chrome')
      )
      absoluteCandidates.push(
        join(home, '.local', 'skynul-chrome', 'opt', 'google', 'chrome', 'chrome')
      )
    }

    // Chromium variants (note: on Ubuntu these may be snap-wrapped).
    absoluteCandidates.push(
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/var/lib/snapd/snap/bin/chromium'
    )
  } else if (platform === 'darwin') {
    absoluteCandidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    )
  } else if (platform === 'win32') {
    const pf = process.env.PROGRAMFILES
    const pf86 = process.env['PROGRAMFILES(X86)']
    const lad = process.env.LOCALAPPDATA
    if (pf) absoluteCandidates.push(join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    if (pf86) absoluteCandidates.push(join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    if (lad) absoluteCandidates.push(join(lad, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  }

  for (const p of absoluteCandidates) {
    if (await isExecutable(p)) return p
  }

  const commandCandidates = [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
    'microsoft-edge-stable',
    'brave-browser',
    'vivaldi',
    'vivaldi-stable',
    'chrome'
  ]
  for (const c of commandCandidates) {
    const resolved = await whichExecutable(c)
    if (resolved) return resolved
  }

  const tried = [...absoluteCandidates, ...commandCandidates].join(', ')
  const envPath = process.env.PATH ?? ''
  throw new Error(
    `Could not find a Chrome/Chromium executable (platform=${platform}). ` +
      `Install Chrome/Chromium (or Edge/Brave/Vivaldi) or set SKYNUL_CHROME_PATH to an absolute path. ` +
      `Tried: ${tried}. PATH=${envPath}`
  )
}

async function readTextFile(p: string, maxBytes = 64 * 1024): Promise<string> {
  try {
    const buf = await readFile(p)
    return buf.slice(0, maxBytes).toString('utf8')
  } catch {
    return ''
  }
}

async function isSnapWrappedChromium(executablePath: string): Promise<boolean> {
  const p = executablePath.toLowerCase()
  if (p.includes('/snap/bin/')) return true
  if (p.includes('/var/lib/snapd/')) return true
  if (p.includes('/snap/')) return true

  // Ubuntu often installs a wrapper at /usr/bin/chromium(-browser) that execs snap.
  if (p === '/usr/bin/chromium' || p === '/usr/bin/chromium-browser') {
    const txt = await readTextFile(executablePath)
    if (/snap\s+run\s+chromium|\/snap\/bin\/chromium|exec\s+chromium-browser\.wrapper/i.test(txt)) {
      return true
    }
  }

  return false
}

async function tryImportExistingChromeProfile(destUserDataDir: string): Promise<void> {
  // Best-effort: import cookies/local storage from the user's existing Chrome profile.
  // This avoids asking the user to log in again in many cases.
  const home = process.env.HOME
  if (!home) return

  const profileDirectoryRaw = process.env.SKYNUL_CHROME_PROFILE_DIRECTORY
  const profileDirectory = (profileDirectoryRaw?.trim() || 'Default').replace(/[\\/]/g, '')

  // Note: on Linux, Chromium installed via snap/flatpak uses non-standard profile locations.
  // We try a handful of common roots.
  const sourceRoots = [
    join(home, '.config', 'google-chrome'),
    join(home, '.config', 'chromium'),
    join(home, 'snap', 'chromium', 'common', 'chromium'),
    join(home, '.var', 'app', 'org.chromium.Chromium', 'config', 'chromium')
  ]

  const destProfileDir = join(destUserDataDir, profileDirectory)
  const srcRoot = await (async () => {
    for (const root of sourceRoots) {
      const p = join(root, profileDirectory)
      if (await pathExists(p)) return root
    }
    return null
  })()
  if (!srcRoot) return

  const srcProfileDir = join(srcRoot, profileDirectory)

  await mkdir(destProfileDir, { recursive: true })

  // Cookies on Linux are usually encrypted; Chrome needs the root "Local State" file to decrypt them.
  // Without it, copied cookie DBs look like an empty session (logged out).
  const srcLocalState = join(srcRoot, 'Local State')
  const destLocalState = join(destUserDataDir, 'Local State')
  try {
    if ((await pathExists(srcLocalState)) && !(await pathExists(destLocalState))) {
      await cp(srcLocalState, destLocalState)
    }
  } catch {
    // ignore
  }

  const copyPaths = [
    'Network/Cookies',
    'Network/Cookies-journal',
    'Cookies',
    'Cookies-journal',
    'Local Storage',
    'Session Storage',
    'Preferences',
    'Secure Preferences'
  ]

  for (const rel of copyPaths) {
    const from = join(srcProfileDir, rel)
    const to = join(destProfileDir, rel)
    try {
      if (!(await pathExists(from))) continue
      await mkdir(dirname(to), { recursive: true })
      // Do not overwrite existing session files; only fill gaps.
      await cp(from, to, { recursive: true, force: false })
    } catch {
      // ignore; profile may be locked or missing
    }
  }
}

export async function launchPlaywrightChromeCdp(): Promise<LaunchResult> {
  const chrome = await resolveChromeExecutable()

  const isWindowsExeOnWsl = isWsl() && chrome.toLowerCase().endsWith('.exe')

  // Playwright's pipe transport (used by launchPersistentContext / --remote-debugging-pipe)
  // does NOT work reliably when launching a Windows browser binary from inside WSL.
  // If the user wants Playwright-only automation, they must install a Linux Chromium-based
  // browser in WSL and point Skynul to it.
  if (isWindowsExeOnWsl) {
    throw new Error(
      'WSL detected but SKYNUL is using a Windows browser binary (chrome.exe). ' +
        'Playwright-only automation requires a Linux Chrome/Chromium installed inside WSL. ' +
        'Install chromium/google-chrome in WSL and set SKYNUL_CHROME_PATH to its Linux path (e.g. /usr/bin/chromium).'
    )
  }

  const fromEnvProfileRaw = process.env.SKYNUL_CHROME_USER_DATA_DIR
  const fromEnvProfile = fromEnvProfileRaw?.trim()
  const userDataDirFromEnv = !!fromEnvProfile
  let userDataDir = fromEnvProfile || join(app.getPath('userData'), 'browser', 'chrome-user-data')
  if (fromEnvProfile && !userDataDir.startsWith('/')) {
    // Avoid surprising relative paths; keep profiles deterministic.
    userDataDir = join(app.getPath('userData'), fromEnvProfile)
  }

  const profileDirectoryRaw = process.env.SKYNUL_CHROME_PROFILE_DIRECTORY
  const profileDirectory = (profileDirectoryRaw?.trim() || 'Default').replace(/[\\/]/g, '')

  const isSnapChromium = process.platform === 'linux' ? await isSnapWrappedChromium(chrome) : false

  const cdpTimeoutFromEnv = Number(process.env.SKYNUL_CHROME_CDP_TIMEOUT_MS || '')
  const cdpTimeoutMs =
    Number.isFinite(cdpTimeoutFromEnv) && cdpTimeoutFromEnv > 0
      ? Math.min(Math.max(1000, cdpTimeoutFromEnv), 180_000)
      : process.platform === 'linux'
        ? 45_000
        : 15_000

  const noSandbox =
    process.env.SKYNUL_CHROME_NO_SANDBOX === '1' || (process.platform === 'linux' && isSnapChromium)

  const baseArgs = [
    `--profile-directory=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=TranslateUI',
    '--new-window',
    ...(noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [])
  ]

  // Pick a stable profile directory for best UX.
  // Problem we avoid: if the first run had to fallback (profile lock), the user logs in there,
  // but later runs go back to the primary dir and look "logged out".
  const preferred = !userDataDirFromEnv ? await readPreferredUserDataDir() : null
  const fallbackDir = `${userDataDir}-fallback`

  // Sometimes a previous Chrome instance gets orphaned and keeps the profile lock.
  // If we're using Skynul's default profile dir, fallback to a deterministic secondary dir first.
  // If the user explicitly set SKYNUL_CHROME_USER_DATA_DIR, do NOT silently fallback.
  const attemptDirs: string[] = []

  if (!userDataDirFromEnv && preferred && (await pathExists(preferred))) {
    attemptDirs.push(preferred)
  }

  if (!userDataDirFromEnv && (await looksLikeChromeProfileDir(fallbackDir, profileDirectory))) {
    if (!attemptDirs.includes(fallbackDir)) attemptDirs.push(fallbackDir)
  }

  if (!attemptDirs.includes(userDataDir)) attemptDirs.push(userDataDir)

  if (!userDataDirFromEnv) {
    // Last resort: unique dir if both are locked.
    attemptDirs.push(`${fallbackDir}-${Date.now().toString(36)}`)
  }

  let existingSessionRetried = false
  for (let attempt = 0; attempt < attemptDirs.length; attempt++) {
    const attemptUserDataDir = attemptDirs[attempt]!

    await mkdir(attemptUserDataDir, { recursive: true })

    // Clean stale SingletonLock — the symlink target encodes hostname-PID.
    // If that PID is not running, the lock is orphaned from a previous crash.
    try {
      const lockPath = join(attemptUserDataDir, 'SingletonLock')
      const target = await readlink(lockPath)
      const pidStr = target.split('-').pop()
      const pid = pidStr ? Number(pidStr) : NaN
      if (!Number.isNaN(pid)) {
        try {
          process.kill(pid, 0) // throws if PID doesn't exist
        } catch {
          await unlink(lockPath).catch(() => {})
          console.warn(`Removed stale Chrome SingletonLock (dead PID ${pid})`)
        }
      }
    } catch {
      // no lock file or not a symlink — fine
    }

    await tryImportExistingChromeProfile(attemptUserDataDir)

    const port = await pickFreePort()
    const args = [
      `--remote-debugging-address=127.0.0.1`,
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${attemptUserDataDir}`,
      ...baseArgs,
      'about:blank'
    ]

    const proc = spawn(chrome, args, { stdio: 'pipe' })

    let stdoutTail = ''
    let stderrTail = ''
    const appendTail = (prev: string, chunk: Buffer): string => {
      const next = (prev + chunk.toString('utf8')).slice(-24_000)
      return next
    }
    proc.stdout?.on('data', (c) => {
      if (Buffer.isBuffer(c)) stdoutTail = appendTail(stdoutTail, c)
    })
    proc.stderr?.on('data', (c) => {
      if (Buffer.isBuffer(c)) stderrTail = appendTail(stderrTail, c)
    })

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        proc.once('exit', (code, signal) => resolve({ code, signal }))
      }
    )

    const spawnErr = await Promise.race([
      new Promise<Error | null>((resolve) => proc.once('error', (e) => resolve(e as Error))),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))
    ])
    if (spawnErr) {
      throw new Error(
        `Failed to launch Chrome (${chrome}). Set SKYNUL_CHROME_PATH if needed. Error: ${spawnErr.message}`
      )
    }

    try {
      // Wait for CDP endpoint; also fail fast if Chrome exits.
      await Promise.race([
        waitForJsonVersion('127.0.0.1', port, cdpTimeoutMs),
        exitPromise.then(({ code, signal }) => {
          // Chrome found an existing session with the same profile and delegated to it.
          // Kill that session so we can relaunch with our debugging port.
          if (code === 0 && stdoutTail.includes('Opening in existing browser session')) {
            throw new Error('EXISTING_SESSION')
          }
          throw new Error(
            `Chrome exited before CDP was ready (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`
          )
        })
      ])
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
      const context = browser.contexts()[0] ?? (await browser.newContext())
      const out: LaunchResult = {
        proc,
        port,
        browser,
        context,
        userDataDir: attemptUserDataDir,
        chromeExecutable: chrome,
        close: async () => {
          try {
            await browser.close()
          } catch {
            // ignore
          }
          try {
            proc.kill('SIGTERM')
          } catch {
            // ignore
          }
        }
      }

      if (!userDataDirFromEnv) {
        // Persist the chosen dir so future launches reuse the same signed-in session.
        void writePreferredUserDataDir(attemptUserDataDir)
      }

      return out
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const looksLikeProfileLock =
        /user data directory is already in use|profile error|profile in use/i.test(msg)
      const looksLikeCdpTimeout = /Timed out waiting for Chrome remote debugging endpoint/i.test(
        msg
      )
      const snapHint =
        isSnapChromium && looksLikeCdpTimeout
          ? 'Detected snap-wrapped Chromium. On Ubuntu this often breaks spawning CDP.\n' +
            'Fix: install Google Chrome (.deb) and set SKYNUL_CHROME_PATH=/usr/bin/google-chrome-stable.'
          : ''

      const tails =
        stdoutTail.trim() || stderrTail.trim()
          ? `\n\n[chrome stdout tail]\n${stdoutTail.trim() || '(empty)'}\n\n[chrome stderr tail]\n${stderrTail.trim() || '(empty)'}`
          : ''
      // Chrome delegated to an already-running instance — kill it and retry this same dir (once)
      if (msg === 'EXISTING_SESSION' && !existingSessionRetried) {
        existingSessionRetried = true
        console.warn(
          'Chrome already running with this profile; killing existing instance and retrying...'
        )
        try {
          const { execSync } = require('child_process')
          const psList = execSync(
            `ps aux | grep -- '--user-data-dir=${attemptUserDataDir}' | grep -v grep | awk '{print $2}'`,
            { timeout: 3000 }
          )
            .toString()
            .trim()
          for (const pidStr of psList.split('\n').filter(Boolean)) {
            try {
              process.kill(Number(pidStr), 'SIGTERM')
            } catch {
              /* already dead */
            }
          }
          await new Promise((r) => setTimeout(r, 1500))
        } catch {
          /* ignore */
        }
        await unlink(join(attemptUserDataDir, 'SingletonLock')).catch(() => {})
        attempt--
        continue
      }

      if (looksLikeProfileLock) {
        // If the user opted into an explicit profile dir, failing fast is clearer.
        if (userDataDirFromEnv) {
          try {
            proc.kill('SIGTERM')
          } catch {
            // ignore
          }
          throw new Error(
            `Chrome profile dir is locked/in use: ${attemptUserDataDir}. ` +
              `Close other Chrome instances using that profile, or unset SKYNUL_CHROME_USER_DATA_DIR to let Skynul manage its own profile.`
          )
        }

        if (attempt < attemptDirs.length - 1) {
          // eslint-disable-next-line no-console
          console.warn(
            `Chrome profile dir locked; retrying with fallback dir: ${attemptUserDataDir}`
          )
          try {
            proc.kill('SIGTERM')
          } catch {
            // ignore
          }
          continue
        }
      }
      try {
        proc.kill('SIGTERM')
      } catch {
        // ignore
      }

      if (looksLikeCdpTimeout) {
        throw new Error(`${msg}${snapHint ? `\n\n${snapHint}` : ''}${tails}`)
      }
      throw new Error(`${msg}${tails}`)
    }
  }

  throw new Error('Failed to launch browser via Playwright after retries')
}

export async function getSharedPlaywrightChromeCdp(): Promise<LaunchResult> {
  if (shared) {
    const procAlive = shared.proc ? shared.proc.exitCode === null && !shared.proc.killed : true
    const browserAlive = shared.browser.isConnected()
    if (procAlive && browserAlive) return shared
    await shared.close().catch(() => {})
    shared = null
  }
  shared = await launchPlaywrightChromeCdp()
  return shared
}

export async function acquirePlaywrightPage(): Promise<{
  page: Page
  release: () => Promise<void>
  userDataDir: string
  chromeExecutable: string
}> {
  const s = await getSharedPlaywrightChromeCdp()
  const page = await s.context.newPage()
  const release = async (): Promise<void> => {
    try {
      await page.close()
    } catch {
      // ignore
    }
  }
  return { page, release, userDataDir: s.userDataDir, chromeExecutable: s.chromeExecutable }
}

export async function closeSharedPlaywrightChromeCdp(): Promise<void> {
  if (!shared) return
  await shared.close().catch(() => {})
  shared = null
}

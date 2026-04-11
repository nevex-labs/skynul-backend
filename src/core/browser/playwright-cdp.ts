import { type ChildProcessWithoutNullStreams, execFile, execFileSync, spawn } from 'child_process';
import { constants as fsConstants } from 'fs';
import { access, cp, mkdir, readFile, readlink, stat, unlink, writeFile } from 'fs/promises';
import http from 'http';
import net from 'net';
import os from 'os';
import { dirname, join } from 'path';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core';
import { parseBrowserSessionMode } from './session-mode';

const CHROME_USER_DATA_DIR = '/tmp/skynul-chrome';

type LaunchResult = {
  proc: ChildProcessWithoutNullStreams | null;
  port: number;
  browser: Browser;
  context: BrowserContext;
  userDataDir: string;
  chromeExecutable: string;
  close: () => Promise<void>;
};

let shared: LaunchResult | null = null;

async function readPreferredUserDataDir(): Promise<string | null> {
  try {
    const p = join(CHROME_USER_DATA_DIR, 'browser', 'chrome-user-data-selected.txt');
    const raw = (await readFile(p, 'utf8')).trim();
    return raw || null;
  } catch {
    return null;
  }
}

async function writePreferredUserDataDir(dir: string): Promise<void> {
  try {
    const p = join(CHROME_USER_DATA_DIR, 'browser', 'chrome-user-data-selected.txt');
    await mkdir(join(CHROME_USER_DATA_DIR, 'browser'), { recursive: true });
    await writeFile(p, `${dir}\n`, 'utf8');
  } catch {
    // ignore
  }
}

async function looksLikeChromeProfileDir(userDataDir: string, profileDirectory: string): Promise<boolean> {
  try {
    if (await pathExists(join(userDataDir, 'Local State'))) return true;
    if (await pathExists(join(userDataDir, profileDirectory, 'Preferences'))) return true;
    return false;
  } catch {
    return false;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    if (!s.isFile()) return false;
    // On Windows it's always executable; on WSL, Windows .exe files are runnable even
    // when the drvfs mount doesn't expose executable bits.
    if (process.platform === 'win32') return true;
    if (isWsl() && p.toLowerCase().endsWith('.exe') && p.startsWith('/mnt/')) return true;
    await access(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function pickFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Could not pick a free port');
  const port = addr.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function httpGetJson(url: string, timeoutMs: number): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function waitForJsonVersion(host: string, port: number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  const url = `http://${host}:${port}/json/version`;
  while (Date.now() - started < timeoutMs) {
    try {
      await httpGetJson(url, 900);
      return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for Chrome remote debugging endpoint (timeout=${timeoutMs}ms). Tried: ${url}`);
}

async function whichExecutable(cmd: string): Promise<string | null> {
  const tool = process.platform === 'win32' ? 'where' : 'which';
  return await new Promise((resolve) => {
    execFile(tool, [cmd], (err: unknown, stdout?: string | Buffer) => {
      if (err) return resolve(null);
      const out = String(stdout ?? '');
      const first = out
        .split(/\r?\n/g)
        .map((s) => s.trim())
        .filter(Boolean)[0];
      resolve(first ?? null);
    });
  });
}

function isWsl(): boolean {
  if (process.platform !== 'linux') return false;
  // Common WSL env vars; os.release() includes "microsoft" on WSL2.
  if (process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME) return true;
  return os.release().toLowerCase().includes('microsoft');
}

async function resolveChromeExecutable(): Promise<string> {
  const fromEnv = await resolveExecutableFromEnv();
  if (fromEnv) return fromEnv;
  const absoluteCandidates = getAbsoluteChromeCandidates(process.platform, process.env.HOME);
  const absolute = await findExecutablePath(absoluteCandidates);
  if (absolute) return absolute;
  const commandCandidates = getChromeCommandCandidates();
  const command = await findExecutableCommand(commandCandidates);
  if (command) return command;
  const platform = process.platform;
  const tried = [...absoluteCandidates, ...commandCandidates].join(', ');
  const envPath = process.env.PATH ?? '';
  throw new Error(
    `Could not find a Chrome/Chromium executable (platform=${platform}). ` +
      `Install Chrome/Chromium (or Edge/Brave/Vivaldi) or set SKYNUL_CHROME_PATH to an absolute path. ` +
      `Tried: ${tried}. PATH=${envPath}`
  );
}

async function resolveExecutableFromEnv(): Promise<string | null> {
  const fromEnv = process.env.SKYNUL_CHROME_PATH?.trim();
  if (!fromEnv) return null;
  if (fromEnv.includes('/') || fromEnv.includes('\\') || fromEnv.endsWith('.exe')) {
    if (await isExecutable(fromEnv)) return fromEnv;
    console.warn(`SKYNUL_CHROME_PATH points to a missing executable: ${fromEnv} (falling back to auto-detection)`);
  }
  const resolved = await whichExecutable(fromEnv);
  if (resolved) return resolved;
  console.warn(`SKYNUL_CHROME_PATH was set but not found in PATH: ${fromEnv} (falling back to auto-detection)`);
  return null;
}

function getAbsoluteChromeCandidates(platform: string, home?: string): string[] {
  if (platform === 'linux') return getLinuxChromeCandidates(home);
  if (platform === 'darwin') return getMacChromeCandidates();
  if (platform === 'win32') return getWindowsChromeCandidates();
  return [];
}

function getLinuxChromeCandidates(home?: string): string[] {
  const out = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/brave-browser',
    '/usr/bin/vivaldi',
    '/usr/bin/vivaldi-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/var/lib/snapd/snap/bin/chromium',
  ];
  if (home) {
    out.push(join(home, '.local', 'skynul-chrome', 'opt', 'google', 'chrome', 'google-chrome'));
    out.push(join(home, '.local', 'skynul-chrome', 'opt', 'google', 'chrome', 'chrome'));
  }
  return out;
}

function getMacChromeCandidates(): string[] {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
}

function getWindowsChromeCandidates(): string[] {
  const out: string[] = [];
  const pf = process.env.PROGRAMFILES;
  const pf86 = process.env['PROGRAMFILES(X86)'];
  const lad = process.env.LOCALAPPDATA;
  if (pf) out.push(join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  if (pf86) out.push(join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  if (lad) out.push(join(lad, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return out;
}

function getChromeCommandCandidates(): string[] {
  return [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
    'microsoft-edge-stable',
    'brave-browser',
    'vivaldi',
    'vivaldi-stable',
    'chrome',
  ];
}

async function findExecutablePath(candidates: string[]): Promise<string | null> {
  for (const p of candidates) {
    if (await isExecutable(p)) return p;
  }
  return null;
}

async function findExecutableCommand(candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    const resolved = await whichExecutable(c);
    if (resolved) return resolved;
  }
  return null;
}

async function readTextFile(p: string, maxBytes = 64 * 1024): Promise<string> {
  try {
    const buf = await readFile(p);
    return buf.slice(0, maxBytes).toString('utf8');
  } catch {
    return '';
  }
}

async function isSnapWrappedChromium(executablePath: string): Promise<boolean> {
  const p = executablePath.toLowerCase();
  if (p.includes('/snap/bin/')) return true;
  if (p.includes('/var/lib/snapd/')) return true;
  if (p.includes('/snap/')) return true;

  // Ubuntu often installs a wrapper at /usr/bin/chromium(-browser) that execs snap.
  if (p === '/usr/bin/chromium' || p === '/usr/bin/chromium-browser') {
    const txt = await readTextFile(executablePath);
    if (/snap\s+run\s+chromium|\/snap\/bin\/chromium|exec\s+chromium-browser\.wrapper/i.test(txt)) {
      return true;
    }
  }

  return false;
}

async function tryImportExistingChromeProfile(destUserDataDir: string): Promise<void> {
  // Best-effort: import cookies/local storage from the user's existing Chrome profile.
  // This avoids asking the user to log in again in many cases.
  const home = process.env.HOME;
  if (!home) return;

  const profileDirectoryRaw = process.env.SKYNUL_CHROME_PROFILE_DIRECTORY;
  const profileDirectory = (profileDirectoryRaw?.trim() || 'Default').replace(/[\\/]/g, '');

  // Note: on Linux, Chromium installed via snap/flatpak uses non-standard profile locations.
  // We try a handful of common roots.
  const sourceRoots = [
    join(home, '.config', 'google-chrome'),
    join(home, '.config', 'chromium'),
    join(home, 'snap', 'chromium', 'common', 'chromium'),
    join(home, '.var', 'app', 'org.chromium.Chromium', 'config', 'chromium'),
  ];

  const destProfileDir = join(destUserDataDir, profileDirectory);
  const srcRoot = await findExistingSourceRoot(sourceRoots, profileDirectory);
  if (!srcRoot) return;

  const srcProfileDir = join(srcRoot, profileDirectory);

  await mkdir(destProfileDir, { recursive: true });

  // Cookies on Linux are usually encrypted; Chrome needs the root "Local State" file to decrypt them.
  // Without it, copied cookie DBs look like an empty session (logged out).
  const srcLocalState = join(srcRoot, 'Local State');
  const destLocalState = join(destUserDataDir, 'Local State');
  await copyIfMissing(srcLocalState, destLocalState);

  const copyPaths = [
    'Network/Cookies',
    'Network/Cookies-journal',
    'Cookies',
    'Cookies-journal',
    'Local Storage',
    'Session Storage',
    'Preferences',
    'Secure Preferences',
  ];

  for (const rel of copyPaths) {
    const from = join(srcProfileDir, rel);
    const to = join(destProfileDir, rel);
    await copyPathBestEffort(from, to);
  }
}

async function findExistingSourceRoot(sourceRoots: string[], profileDirectory: string): Promise<string | null> {
  for (const root of sourceRoots) {
    const p = join(root, profileDirectory);
    if (await pathExists(p)) return root;
  }
  return null;
}

async function copyIfMissing(from: string, to: string): Promise<void> {
  try {
    if ((await pathExists(from)) && !(await pathExists(to))) await cp(from, to);
  } catch {}
}

async function copyPathBestEffort(from: string, to: string): Promise<void> {
  try {
    if (!(await pathExists(from))) return;
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to, { recursive: true, force: false });
  } catch {}
}

type LaunchSetup = {
  userDataDirFromEnv: boolean;
  profileDirectory: string;
  isSnapChromium: boolean;
  cdpTimeoutMs: number;
  baseArgs: string[];
  attemptDirs: string[];
  fallbackDir: string;
};

type LaunchAttemptIo = {
  stdoutTail: string;
  stderrTail: string;
};

type PreparedAttempt = {
  proc: ChildProcessWithoutNullStreams;
  io: LaunchAttemptIo;
  port: number;
  exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

type AttemptErrorResolution = {
  action: 'retry_same' | 'retry_next' | 'throw';
  nextExistingSessionRetried: boolean;
  error?: Error;
};

type LaunchAttemptOutcome =
  | { kind: 'success'; result: LaunchResult; nextExistingSessionRetried: boolean }
  | { kind: 'retry_same'; nextExistingSessionRetried: boolean }
  | { kind: 'retry_next'; nextExistingSessionRetried: boolean }
  | { kind: 'throw'; error: Error; nextExistingSessionRetried: boolean };

function assertSupportedWslExecutable(chrome: string): void {
  const isWindowsExeOnWsl = isWsl() && chrome.toLowerCase().endsWith('.exe');
  if (!isWindowsExeOnWsl) return;
  throw new Error(
    'WSL detected but SKYNUL is using a Windows browser binary (chrome.exe). ' +
      'Playwright-only automation requires a Linux Chrome/Chromium installed inside WSL. ' +
      'Install chromium/google-chrome in WSL and set SKYNUL_CHROME_PATH to its Linux path (e.g. /usr/bin/chromium).'
  );
}

function resolveUserDataDir(): { userDataDir: string; userDataDirFromEnv: boolean } {
  const fromEnvProfile = process.env.SKYNUL_CHROME_USER_DATA_DIR?.trim();
  const userDataDirFromEnv = Boolean(fromEnvProfile);
  let userDataDir = fromEnvProfile || join(CHROME_USER_DATA_DIR, 'browser', 'chrome-user-data');
  if (fromEnvProfile && !userDataDir.startsWith('/')) userDataDir = join(CHROME_USER_DATA_DIR, fromEnvProfile);
  return { userDataDir, userDataDirFromEnv };
}

function resolveProfileDirectory(): string {
  const profileDirectoryRaw = process.env.SKYNUL_CHROME_PROFILE_DIRECTORY;
  return (profileDirectoryRaw?.trim() || 'Default').replace(/[\\/]/g, '');
}

function resolveCdpTimeoutMs(): number {
  const cdpTimeoutFromEnv = Number(process.env.SKYNUL_CHROME_CDP_TIMEOUT_MS || '');
  if (Number.isFinite(cdpTimeoutFromEnv) && cdpTimeoutFromEnv > 0) {
    return Math.min(Math.max(1000, cdpTimeoutFromEnv), 180_000);
  }
  return process.platform === 'linux' ? 45_000 : 15_000;
}

function resolveBaseArgs(profileDirectory: string, isSnapChromium: boolean): string[] {
  const noSandbox = process.env.SKYNUL_CHROME_NO_SANDBOX === '1' || (process.platform === 'linux' && isSnapChromium);
  return [
    `--profile-directory=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=TranslateUI',
    '--new-window',
    ...(noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
  ];
}

async function buildAttemptDirs(
  userDataDir: string,
  userDataDirFromEnv: boolean,
  profileDirectory: string
): Promise<{ attemptDirs: string[]; fallbackDir: string }> {
  const preferred = !userDataDirFromEnv ? await readPreferredUserDataDir() : null;
  const fallbackDir = `${userDataDir}-fallback`;
  const attemptDirs: string[] = [];

  if (!userDataDirFromEnv && preferred && (await pathExists(preferred))) attemptDirs.push(preferred);
  if (!userDataDirFromEnv && (await looksLikeChromeProfileDir(fallbackDir, profileDirectory))) {
    if (!attemptDirs.includes(fallbackDir)) attemptDirs.push(fallbackDir);
  }
  if (!attemptDirs.includes(userDataDir)) attemptDirs.push(userDataDir);
  if (!userDataDirFromEnv) attemptDirs.push(`${fallbackDir}-${Date.now().toString(36)}`);
  return { attemptDirs, fallbackDir };
}

async function buildLaunchSetup(chrome: string): Promise<LaunchSetup> {
  const { userDataDir, userDataDirFromEnv } = resolveUserDataDir();
  const profileDirectory = resolveProfileDirectory();
  const isSnapChromium = process.platform === 'linux' ? await isSnapWrappedChromium(chrome) : false;
  const cdpTimeoutMs = resolveCdpTimeoutMs();
  const baseArgs = resolveBaseArgs(profileDirectory, isSnapChromium);
  const { attemptDirs, fallbackDir } = await buildAttemptDirs(userDataDir, userDataDirFromEnv, profileDirectory);
  return { userDataDirFromEnv, profileDirectory, isSnapChromium, cdpTimeoutMs, baseArgs, attemptDirs, fallbackDir };
}

async function cleanupStaleSingletonLock(attemptUserDataDir: string): Promise<void> {
  try {
    const lockPath = join(attemptUserDataDir, 'SingletonLock');
    const target = await readlink(lockPath);
    const pidStr = target.split('-').pop();
    const pid = pidStr ? Number(pidStr) : Number.NaN;
    if (Number.isNaN(pid)) return;
    try {
      process.kill(pid, 0);
    } catch {
      await unlink(lockPath).catch(() => {});
      console.warn(`Removed stale Chrome SingletonLock (dead PID ${pid})`);
    }
  } catch {}
}

function attachProcessTails(proc: ChildProcessWithoutNullStreams): LaunchAttemptIo {
  const io: LaunchAttemptIo = { stdoutTail: '', stderrTail: '' };
  const appendTail = (prev: string, chunk: Buffer): string => (prev + chunk.toString('utf8')).slice(-24_000);
  proc.stdout?.on('data', (c) => {
    if (Buffer.isBuffer(c)) io.stdoutTail = appendTail(io.stdoutTail, c);
  });
  proc.stderr?.on('data', (c) => {
    if (Buffer.isBuffer(c)) io.stderrTail = appendTail(io.stderrTail, c);
  });
  return io;
}

async function killProcessSafe(proc: ChildProcessWithoutNullStreams): Promise<void> {
  try {
    proc.kill('SIGTERM');
  } catch {}
}

function buildLaunchResult(
  proc: ChildProcessWithoutNullStreams,
  port: number,
  browser: Browser,
  context: BrowserContext,
  attemptUserDataDir: string,
  chrome: string
): LaunchResult {
  return {
    proc,
    port,
    browser,
    context,
    userDataDir: attemptUserDataDir,
    chromeExecutable: chrome,
    close: async () => {
      try {
        await browser.close();
      } catch {}
      try {
        proc.kill('SIGTERM');
      } catch {}
    },
  };
}

function getAttemptErrorMeta(
  msg: string,
  isSnapChromium: boolean,
  io: LaunchAttemptIo
): {
  looksLikeProfileLock: boolean;
  looksLikeCdpTimeout: boolean;
  tails: string;
  snapHint: string;
} {
  const looksLikeProfileLock = /user data directory is already in use|profile error|profile in use/i.test(msg);
  const looksLikeCdpTimeout = /Timed out waiting for Chrome remote debugging endpoint/i.test(msg);
  const snapHint =
    isSnapChromium && looksLikeCdpTimeout
      ? 'Detected snap-wrapped Chromium. On Ubuntu this often breaks spawning CDP.\n' +
        'Fix: install Google Chrome (.deb) and set SKYNUL_CHROME_PATH=/usr/bin/google-chrome-stable.'
      : '';
  const tails =
    io.stdoutTail.trim() || io.stderrTail.trim()
      ? `\n\n[chrome stdout tail]\n${io.stdoutTail.trim() || '(empty)'}\n\n[chrome stderr tail]\n${io.stderrTail.trim() || '(empty)'}`
      : '';
  return { looksLikeProfileLock, looksLikeCdpTimeout, tails, snapHint };
}

async function tryKillExistingSessionByUserDataDir(attemptUserDataDir: string): Promise<void> {
  try {
    const pids = findChromePidsByUserDataDir(attemptUserDataDir);
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    if (pids.length) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (e) {
    console.warn('[browser] failed to kill existing session:', e instanceof Error ? e.message : e);
  }
}

function findChromePidsByUserDataDir(userDataDir: string): number[] {
  try {
    const psOutput = execFileSync('ps', ['aux'], { timeout: 3000, encoding: 'utf8' });
    const needle = `--user-data-dir=${userDataDir}`;
    const pids: number[] = [];
    for (const line of psOutput.split('\n')) {
      if (!line.includes(needle) || line.includes('grep')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[1]);
      if (Number.isFinite(pid) && pid > 1) pids.push(pid);
    }
    return pids;
  } catch {
    return [];
  }
}

async function prepareAttempt(
  chrome: string,
  attemptUserDataDir: string,
  baseArgs: string[]
): Promise<PreparedAttempt> {
  await mkdir(attemptUserDataDir, { recursive: true });
  await cleanupStaleSingletonLock(attemptUserDataDir);
  await tryImportExistingChromeProfile(attemptUserDataDir);

  const port = await pickFreePort();
  const args = [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${attemptUserDataDir}`,
    ...baseArgs,
    'about:blank',
  ];
  const proc = spawn(chrome, args, { stdio: 'pipe' });
  const io = attachProcessTails(proc);
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    proc.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const spawnErr = await Promise.race([
    new Promise<Error | null>((resolve) => proc.once('error', (e) => resolve(e as Error))),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
  ]);
  if (spawnErr) {
    throw new Error(
      `Failed to launch Chrome (${chrome}). Set SKYNUL_CHROME_PATH if needed. Error: ${spawnErr.message}`
    );
  }
  return { proc, io, port, exitPromise };
}

async function connectAttempt(
  prepared: PreparedAttempt,
  cdpTimeoutMs: number,
  attemptUserDataDir: string,
  chrome: string
): Promise<LaunchResult> {
  const { proc, io, port, exitPromise } = prepared;
  await Promise.race([
    waitForJsonVersion('127.0.0.1', port, cdpTimeoutMs),
    exitPromise.then(({ code, signal }) => {
      if (code === 0 && io.stdoutTail.includes('Opening in existing browser session')) {
        throw new Error('EXISTING_SESSION');
      }
      throw new Error(`Chrome exited before CDP was ready (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`);
    }),
  ]);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  return buildLaunchResult(proc, port, browser, context, attemptUserDataDir, chrome);
}

async function resolveAttemptError(
  msg: string,
  isSnapChromium: boolean,
  io: LaunchAttemptIo,
  attemptUserDataDir: string,
  userDataDirFromEnv: boolean,
  hasNextAttempt: boolean,
  existingSessionRetried: boolean,
  proc: ChildProcessWithoutNullStreams
): Promise<AttemptErrorResolution> {
  const { looksLikeProfileLock, looksLikeCdpTimeout, tails, snapHint } = getAttemptErrorMeta(msg, isSnapChromium, io);
  const existingResolution = await resolveExistingSessionError(msg, attemptUserDataDir, existingSessionRetried);
  if (existingResolution) return existingResolution;

  const profileResolution = await resolveProfileLockError(
    looksLikeProfileLock,
    userDataDirFromEnv,
    hasNextAttempt,
    attemptUserDataDir,
    existingSessionRetried,
    proc
  );
  if (profileResolution) return profileResolution;

  return await resolveGenericAttemptError(looksLikeCdpTimeout, msg, snapHint, tails, existingSessionRetried, proc);
}

async function resolveExistingSessionError(
  msg: string,
  attemptUserDataDir: string,
  existingSessionRetried: boolean
): Promise<AttemptErrorResolution | null> {
  if (msg !== 'EXISTING_SESSION' || existingSessionRetried) return null;
  const allowKill = ['1', 'true', 'yes'].includes(
    (process.env.SKYNUL_CHROME_KILL_EXISTING_SESSION ?? '').trim().toLowerCase()
  );
  if (!allowKill) {
    return {
      action: 'throw',
      nextExistingSessionRetried: existingSessionRetried,
      error: new Error(
        `Chrome is already running with this profile dir: ${attemptUserDataDir}. ` +
          'Close the existing Chrome instance, or set SKYNUL_CHROME_KILL_EXISTING_SESSION=1 to allow Skynul to terminate it automatically.'
      ),
    };
  }
  console.warn('Chrome already running with this profile; killing existing instance and retrying...');
  await tryKillExistingSessionByUserDataDir(attemptUserDataDir);
  await unlink(join(attemptUserDataDir, 'SingletonLock')).catch(() => {});
  return { action: 'retry_same', nextExistingSessionRetried: true };
}

async function resolveProfileLockError(
  looksLikeProfileLock: boolean,
  userDataDirFromEnv: boolean,
  hasNextAttempt: boolean,
  attemptUserDataDir: string,
  existingSessionRetried: boolean,
  proc: ChildProcessWithoutNullStreams
): Promise<AttemptErrorResolution | null> {
  if (!looksLikeProfileLock) return null;
  if (userDataDirFromEnv) {
    await killProcessSafe(proc);
    return {
      action: 'throw',
      nextExistingSessionRetried: existingSessionRetried,
      error: new Error(
        `Chrome profile dir is locked/in use: ${attemptUserDataDir}. ` +
          'Close other Chrome instances using that profile, or unset SKYNUL_CHROME_USER_DATA_DIR to let Skynul manage its own profile.'
      ),
    };
  }
  if (!hasNextAttempt) return null;
  console.warn(`Chrome profile dir locked; retrying with fallback dir: ${attemptUserDataDir}`);
  await killProcessSafe(proc);
  return { action: 'retry_next', nextExistingSessionRetried: existingSessionRetried };
}

async function resolveGenericAttemptError(
  looksLikeCdpTimeout: boolean,
  msg: string,
  snapHint: string,
  tails: string,
  existingSessionRetried: boolean,
  proc: ChildProcessWithoutNullStreams
): Promise<AttemptErrorResolution> {
  await killProcessSafe(proc);
  if (looksLikeCdpTimeout) {
    return {
      action: 'throw',
      nextExistingSessionRetried: existingSessionRetried,
      error: new Error(`${msg}${snapHint ? `\n\n${snapHint}` : ''}${tails}`),
    };
  }
  return { action: 'throw', nextExistingSessionRetried: existingSessionRetried, error: new Error(`${msg}${tails}`) };
}

async function runLaunchAttempt(
  chrome: string,
  baseArgs: string[],
  cdpTimeoutMs: number,
  attemptUserDataDir: string,
  isSnapChromium: boolean,
  userDataDirFromEnv: boolean,
  hasNextAttempt: boolean,
  existingSessionRetried: boolean
): Promise<LaunchAttemptOutcome> {
  let prepared: PreparedAttempt | null = null;
  try {
    prepared = await prepareAttempt(chrome, attemptUserDataDir, baseArgs);
    const result = await connectAttempt(prepared, cdpTimeoutMs, attemptUserDataDir, chrome);
    return { kind: 'success', result, nextExistingSessionRetried: existingSessionRetried };
  } catch (e) {
    if (!prepared) throw e;
    return await mapLaunchAttemptErrorToOutcome(
      e,
      prepared,
      attemptUserDataDir,
      isSnapChromium,
      userDataDirFromEnv,
      hasNextAttempt,
      existingSessionRetried
    );
  }
}

async function mapLaunchAttemptErrorToOutcome(
  err: unknown,
  prepared: PreparedAttempt,
  attemptUserDataDir: string,
  isSnapChromium: boolean,
  userDataDirFromEnv: boolean,
  hasNextAttempt: boolean,
  existingSessionRetried: boolean
): Promise<LaunchAttemptOutcome> {
  const msg = err instanceof Error ? err.message : String(err);
  const resolved = await resolveAttemptError(
    msg,
    isSnapChromium,
    prepared.io,
    attemptUserDataDir,
    userDataDirFromEnv,
    hasNextAttempt,
    existingSessionRetried,
    prepared.proc
  );
  if (resolved.action === 'retry_same') {
    return { kind: 'retry_same', nextExistingSessionRetried: resolved.nextExistingSessionRetried };
  }
  if (resolved.action === 'retry_next') {
    return { kind: 'retry_next', nextExistingSessionRetried: resolved.nextExistingSessionRetried };
  }
  return {
    kind: 'throw',
    error: resolved.error ?? (err instanceof Error ? err : new Error(msg)),
    nextExistingSessionRetried: resolved.nextExistingSessionRetried,
  };
}

export async function launchPlaywrightChromeCdp(): Promise<LaunchResult> {
  const chrome = await resolveChromeExecutable();
  assertSupportedWslExecutable(chrome);
  const setup = await buildLaunchSetup(chrome);
  const { attemptDirs, fallbackDir, baseArgs, cdpTimeoutMs, isSnapChromium, userDataDirFromEnv } = setup;

  let existingSessionRetried = false;
  for (let attempt = 0; attempt < attemptDirs.length; attempt++) {
    const attemptUserDataDir = attemptDirs[attempt] ?? `${fallbackDir}-${attempt}`;

    const outcome = await runLaunchAttempt(
      chrome,
      baseArgs,
      cdpTimeoutMs,
      attemptUserDataDir,
      isSnapChromium,
      userDataDirFromEnv,
      attempt < attemptDirs.length - 1,
      existingSessionRetried
    );
    existingSessionRetried = outcome.nextExistingSessionRetried;

    if (outcome.kind === 'retry_same') {
      attempt--;
      continue;
    }
    if (outcome.kind === 'retry_next') continue;
    if (outcome.kind === 'throw') throw outcome.error;
    if (!userDataDirFromEnv) {
      void writePreferredUserDataDir(attemptUserDataDir);
    }
    return outcome.result;
  }

  throw new Error('Failed to launch browser via Playwright after retries');
}

export async function getSharedPlaywrightChromeCdp(): Promise<LaunchResult> {
  if (shared) {
    const procAlive = shared.proc ? shared.proc.exitCode === null && !shared.proc.killed : true;
    const browserAlive = shared.browser.isConnected();
    if (procAlive && browserAlive) return shared;
    await shared.close().catch(() => {});
    shared = null;
  }
  shared = await launchPlaywrightChromeCdp();
  return shared;
}

export async function acquirePlaywrightPage(): Promise<{
  page: Page;
  release: () => Promise<void>;
  userDataDir: string;
  chromeExecutable: string;
}> {
  const mode = parseBrowserSessionMode();
  const s = mode === 'per-task' ? await launchPlaywrightChromeCdp() : await getSharedPlaywrightChromeCdp();
  const page = await s.context.newPage();
  const release = async (): Promise<void> => {
    try {
      await page.close();
    } catch {
      // ignore
    }
    if (mode === 'per-task') {
      await s.close().catch(() => {});
    }
  };
  return { page, release, userDataDir: s.userDataDir, chromeExecutable: s.chromeExecutable };
}

export async function closeSharedPlaywrightChromeCdp(): Promise<void> {
  if (!shared) return;
  await shared.close().catch(() => {});
  shared = null;
}

import { normalize, resolve } from 'path';

/**
 * Validate and sandbox a file path within allowed roots.
 * Returns the resolved absolute path or throws.
 */
export function sandboxPath(filePath: string, cwd?: string): string {
  const resolved = cwd ? resolve(cwd, filePath) : resolve(filePath);
  const normalized = normalize(resolved);

  const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const allowedRoots = [normalize(home), normalize('/tmp'), normalize(process.cwd())];

  if (!allowedRoots.some((root) => normalized.startsWith(root + '/') || normalized === root)) {
    throw new Error(`Path "${filePath}" resolves outside allowed directories`);
  }

  const BLOCKED_PATTERNS = [
    /\.ssh\//i,
    /\.gnupg\//i,
    /\.env$/i,
    /\/\.git\/config$/i,
    /id_rsa/i,
    /id_ed25519/i,
    /authorized_keys/i,
    /shadow$/,
    /\/etc\/passwd$/,
  ];

  if (BLOCKED_PATTERNS.some((p) => p.test(normalized))) {
    throw new Error(`Access to "${filePath}" is blocked for security`);
  }

  return normalized;
}

/**
 * Validate a URL to prevent SSRF attacks.
 * Blocks private IPs, localhost, file://, and cloud metadata endpoints.
 */
export function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Blocked protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) {
    throw new Error(`Blocked URL: localhost access not allowed`);
  }

  const parts = hostname.split('.').map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
    if (parts[0] === 10) throw new Error('Blocked: private IP (10.x.x.x)');
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) throw new Error('Blocked: private IP (172.16-31.x.x)');
    if (parts[0] === 192 && parts[1] === 168) throw new Error('Blocked: private IP (192.168.x.x)');
    if (parts[0] === 169 && parts[1] === 254) throw new Error('Blocked: metadata endpoint (169.254.x.x)');
  }
}

/**
 * Validate a shell command — block dangerous patterns.
 * Defense-in-depth: not a full sandbox.
 */
export function validateShellCommand(command: string): void {
  const BLOCKED_COMMANDS = [
    /\brm\s+(-[rfR]+\s+)?[\/~]/,
    /\bmkfs\b/,
    /\bdd\s+.*of=\/dev\//,
    />\s*\/dev\/sd[a-z]/,
    /\bshutdown\b/,
    /\breboot\b/,
    /\bpasswd\b/,
    /\buseradd\b/,
    /\buserdel\b/,
    /\bchmod\s+[0-7]*777/,
    /\bcurl\b.*\|\s*(ba)?sh/,
    /\bwget\b.*\|\s*(ba)?sh/,
  ];

  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      throw new Error(`Blocked: command matches dangerous pattern "${pattern.source}"`);
    }
  }
}

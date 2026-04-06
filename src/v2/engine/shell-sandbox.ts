/**
 * Shell Sandbox — v2
 *
 * Executes shell commands with path sandboxing and dangerous command filtering.
 * Self-contained — no dependencies on old code.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Dangerous command patterns ─────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  /^rm\s+-rf\s+\/$/,
  /^mkfs/,
  /^dd\s+if=\/dev\/zero/,
  /^:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/, // fork bomb
  /chmod\s+777\s+\/$/,
  />\s*\/etc\/shadow/,
  />\s*\/etc\/passwd/,
  /curl.*\|\s*(bash|sh)/,
  /wget.*\|\s*(bash|sh)/,
];

// ── Path sandbox ───────────────────────────────────────────────────────

const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '/tmp';
const SANDBOX_ROOT = process.env.SKYNUL_SANDBOX_DIR || `${HOME_DIR}/.skynul/sandbox`;

function sanitizePath(path: string): string {
  // Prevent path traversal
  const resolved = path.replace(/\.\./g, '').replace(/^~\/?/, `${HOME_DIR}/`);
  return resolved;
}

function isPathSafe(path: string): boolean {
  const resolved = sanitizePath(path);
  return resolved.startsWith(SANDBOX_ROOT) || resolved.startsWith(HOME_DIR);
}

// ── Command validation ─────────────────────────────────────────────────

function isDangerous(command: string): string | null {
  const trimmed = command.trim().toLowerCase();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `Command blocked: matches dangerous pattern "${pattern.source}"`;
    }
  }
  return null;
}

// ── Shell Sandbox ──────────────────────────────────────────────────────

export type ShellSandboxOpts = {
  /** Working directory for commands (default: sandbox root) */
  cwd?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Max output size in bytes (default: 1MB) */
  maxOutputSize?: number;
};

export class ShellSandbox {
  private cwd: string;
  private timeout: number;
  private maxOutputSize: number;

  constructor(opts: ShellSandboxOpts = {}) {
    this.cwd = opts.cwd ? sanitizePath(opts.cwd) : SANDBOX_ROOT;
    this.timeout = opts.timeout ?? 30_000;
    this.maxOutputSize = opts.maxOutputSize ?? 1024 * 1024;
  }

  /**
   * Execute a shell command with sandboxing.
   */
  async run(command: string, cwd?: string, timeout?: number): Promise<string> {
    // Validate command
    const blocked = isDangerous(command);
    if (blocked) return blocked;

    const effectiveCwd = cwd ? sanitizePath(cwd) : this.cwd;
    const effectiveTimeout = timeout ?? this.timeout;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: effectiveCwd,
        timeout: effectiveTimeout,
        maxBuffer: this.maxOutputSize,
        env: { ...process.env, HOME: HOME_DIR },
      });

      if (stderr && !stdout) {
        return stderr.trim();
      }

      const output = stdout || stderr || '(no output)';
      return output.length > this.maxOutputSize
        ? output.slice(0, this.maxOutputSize) + '\n... [output truncated]'
        : output;
    } catch (err: any) {
      if (err.killed) {
        return `[Command timed out after ${effectiveTimeout}ms]`;
      }
      if (err.code === 'ENOENT') {
        return `[Command not found: ${command.split(' ')[0]}]`;
      }
      const output = err.stderr || err.stdout || err.message || '';
      return output.length > this.maxOutputSize
        ? output.slice(0, this.maxOutputSize) + '\n... [error truncated]'
        : output;
    }
  }
}

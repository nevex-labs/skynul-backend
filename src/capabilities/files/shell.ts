import { validateShellCommand } from '../../core/util/input-guard';

type ExecutorResult = { ok: true; value: string } | { ok: false; error: string };

function headTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.6);
  const tail = limit - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n\n[... ${omitted} chars omitted ...]\n\n${text.slice(text.length - tail)}`;
}

function buildShellResult(err: Error | null, stdout: string, stderr: string): ExecutorResult {
  const out = headTail(stdout.toString(), 4000);
  const errOut = stderr.toString().slice(0, 1000);
  if (err) {
    return {
      ok: true,
      value: `[Exit ${(err as NodeJS.ErrnoException).code ?? 1}] ${errOut || err.message}\n${out}`.trim(),
    };
  }
  return { ok: true, value: errOut ? `${out}\n[stderr] ${errOut}` : out || '(no output)' };
}

export async function executeShell(command: string, cwd?: string, timeoutMs?: number): Promise<ExecutorResult> {
  try {
    validateShellCommand(command);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return new Promise((resolve) => {
    const { exec } = require('node:child_process');
    const timeout = Math.min(timeoutMs ?? 120_000, 300_000);
    exec(
      command,
      { timeout, maxBuffer: 1024 * 1024, cwd: cwd || undefined },
      (err: Error | null, stdout: string, stderr: string) => resolve(buildShellResult(err, stdout, stderr))
    );
  });
}

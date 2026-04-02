/**
 * Process Registry — Background process management for long-running commands.
 *
 * When a shell command exceeds the timeout threshold, it's moved to background
 * execution. The ProcessRegistry tracks these processes and provides:
 * - Registration with metadata (PID, command, start time)
 * - Polling for status and output
 * - Kill functionality
 * - Automatic cleanup on task completion
 */

import { type ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { childLogger } from '../logger';

const logger = childLogger({ component: 'process-registry' });

export type ProcessStatus = 'running' | 'completed' | 'failed' | 'killed';

export type BackgroundProcess = {
  id: string;
  taskId: string;
  command: string;
  pid: number;
  startTime: number;
  status: ProcessStatus;
  exitCode?: number;
  stdout: string;
  stderr: string;
  cwd?: string;
  env?: Record<string, string>;
};

export type ProcessRegistryConfig = {
  /** Default timeout for tools in ms (default: 30000) */
  defaultTimeoutMs: number;
  /** Per-action-type timeouts */
  actionTimeouts: Record<string, number>;
  /** Max processes per task (default: 5) */
  maxProcessesPerTask: number;
  /** Auto-kill processes when task ends (default: true) */
  autoCleanup: boolean;
  /** Polling interval for background processes (default: 1000ms) */
  pollingIntervalMs: number;
};

export const DEFAULT_REGISTRY_CONFIG: ProcessRegistryConfig = {
  defaultTimeoutMs: 30000,
  actionTimeouts: {
    shell: 60000,
    npm: 120000,
    docker: 300000,
    web_scrape: 30000,
    file_read: 10000,
    file_write: 10000,
  },
  maxProcessesPerTask: 5,
  autoCleanup: true,
  pollingIntervalMs: 1000,
};

class ProcessRegistry {
  private processes = new Map<string, BackgroundProcess>();
  private childProcesses = new Map<string, ChildProcess>();
  private config: ProcessRegistryConfig;

  constructor(config?: Partial<ProcessRegistryConfig>) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
  }

  /**
   * Execute a command with timeout. If it completes within timeout, return result.
   * If it exceeds timeout, move to background and return handle.
   */
  async executeWithTimeout(
    command: string,
    taskId: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      actionType?: string;
    }
  ): Promise<
    | { type: 'completed'; exitCode: number; stdout: string; stderr: string }
    | { type: 'background'; processId: string; message: string }
  > {
    const timeoutMs =
      options?.timeoutMs ??
      (options?.actionType ? this.config.actionTimeouts[options.actionType] : undefined) ??
      this.config.defaultTimeoutMs;

    return new Promise((resolve) => {
      const env = options?.env ? { ...process.env, ...options.env } : process.env;
      const child = spawn(command, {
        shell: true,
        cwd: options?.cwd,
        env: env as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let completed = false;

      // Collect output
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        // Limit memory usage
        if (stdout.length > 1024 * 1024) {
          stdout = stdout.slice(-1024 * 1024);
        }
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > 1024 * 1024) {
          stderr = stderr.slice(-1024 * 1024);
        }
      });

      // Handle completion
      child.on('exit', (code) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutId);
        resolve({
          type: 'completed',
          exitCode: code ?? 0,
          stdout,
          stderr,
        });
      });

      child.on('error', (err) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutId);
        stderr += `\nProcess error: ${err.message}`;
        resolve({
          type: 'completed',
          exitCode: 1,
          stdout,
          stderr,
        });
      });

      // Timeout handler
      const timeoutId = setTimeout(() => {
        if (completed) return;

        // Check if we've hit the per-task limit
        const taskProcesses = this.getTaskProcesses(taskId);
        if (taskProcesses.length >= this.config.maxProcessesPerTask) {
          child.kill('SIGTERM');
          resolve({
            type: 'completed',
            exitCode: 1,
            stdout,
            stderr: `Error: Max background processes (${this.config.maxProcessesPerTask}) reached for task`,
          });
          return;
        }

        // Move to background
        const processId = this.register(child, command, taskId, {
          stdout,
          stderr,
          cwd: options?.cwd,
          env: options?.env,
        });

        resolve({
          type: 'background',
          processId,
          message: `Command exceeded ${timeoutMs}ms timeout. Moved to background with ID: ${processId}. Use "check ${processId}" to poll status.`,
        });
      }, timeoutMs);
    });
  }

  /**
   * Register a running child process in the registry.
   */
  private register(
    child: ChildProcess,
    command: string,
    taskId: string,
    initialData: {
      stdout: string;
      stderr: string;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): string {
    const id = `bg_${randomUUID().slice(0, 8)}`;

    const process: BackgroundProcess = {
      id,
      taskId,
      command,
      pid: child.pid!,
      startTime: Date.now(),
      status: 'running',
      stdout: initialData.stdout,
      stderr: initialData.stderr,
      cwd: initialData.cwd,
      env: initialData.env,
    };

    this.processes.set(id, process);
    this.childProcesses.set(id, child);

    // Continue collecting output in background
    child.stdout?.on('data', (data) => {
      const proc = this.processes.get(id);
      if (proc) {
        proc.stdout += data.toString();
        if (proc.stdout.length > 10 * 1024 * 1024) {
          proc.stdout = proc.stdout.slice(-5 * 1024 * 1024) + '\n[...truncated...]';
        }
      }
    });

    child.stderr?.on('data', (data) => {
      const proc = this.processes.get(id);
      if (proc) {
        proc.stderr += data.toString();
        if (proc.stderr.length > 10 * 1024 * 1024) {
          proc.stderr = proc.stderr.slice(-5 * 1024 * 1024) + '\n[...truncated...]';
        }
      }
    });

    child.on('exit', (code) => {
      const proc = this.processes.get(id);
      if (proc) {
        proc.status = code === 0 ? 'completed' : 'failed';
        proc.exitCode = code ?? undefined;
      }
      this.childProcesses.delete(id);
      logger.info({ processId: id, exitCode: code }, 'Background process completed');
    });

    logger.info({ processId: id, taskId, command: command.slice(0, 50) }, 'Background process registered');
    return id;
  }

  /**
   * Poll a background process for status.
   */
  poll(processId: string): {
    found: boolean;
    status?: ProcessStatus;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    elapsedMs?: number;
    message: string;
  } {
    const proc = this.processes.get(processId);

    if (!proc) {
      return { found: false, message: `Process ${processId} not found` };
    }

    const elapsedMs = Date.now() - proc.startTime;

    // Return new output since last poll (or all if completed)
    const child = this.childProcesses.get(processId);
    const isRunning = child !== undefined && !child.killed;

    if (proc.status === 'running' && !isRunning) {
      // Process died without exit event
      proc.status = 'failed';
      proc.exitCode = -1;
    }

    return {
      found: true,
      status: proc.status,
      exitCode: proc.exitCode,
      stdout: proc.stdout,
      stderr: proc.stderr,
      elapsedMs,
      message:
        proc.status === 'running'
          ? `Process ${processId} still running (${elapsedMs}ms elapsed)`
          : `Process ${processId} ${proc.status} with exit code ${proc.exitCode}`,
    };
  }

  /**
   * Kill a background process.
   */
  kill(processId: string, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): { success: boolean; message: string } {
    const proc = this.processes.get(processId);
    const child = this.childProcesses.get(processId);

    if (!proc) {
      return { success: false, message: `Process ${processId} not found` };
    }

    if (proc.status !== 'running') {
      return { success: false, message: `Process ${processId} already ${proc.status}` };
    }

    if (child && !child.killed) {
      child.kill(signal);
      proc.status = 'killed';
      this.childProcesses.delete(processId);
      logger.info({ processId, signal }, 'Background process killed');
      return { success: true, message: `Process ${processId} killed with ${signal}` };
    }

    // Process died between poll and kill
    proc.status = 'failed';
    proc.exitCode = -1;
    return { success: false, message: `Process ${processId} already terminated` };
  }

  /**
   * Get all processes for a task.
   */
  getTaskProcesses(taskId: string): BackgroundProcess[] {
    return Array.from(this.processes.values()).filter((p) => p.taskId === taskId);
  }

  /**
   * Cleanup all processes for a task (called when task ends).
   */
  cleanupTask(taskId: string): { killed: number; errors: string[] } {
    const processes = this.getTaskProcesses(taskId);
    let killed = 0;
    const errors: string[] = [];

    for (const proc of processes) {
      if (proc.status === 'running') {
        const result = this.kill(proc.id, 'SIGTERM');
        if (result.success) {
          killed++;
        } else {
          errors.push(result.message);
        }
      }
      // Keep completed/failed processes for debugging, just mark as cleaned
    }

    logger.info({ taskId, killed, total: processes.length }, 'Task processes cleaned up');
    return { killed, errors };
  }

  /**
   * Get process stats.
   */
  getStats(): {
    total: number;
    running: number;
    completed: number;
    failed: number;
    killed: number;
  } {
    const processes = Array.from(this.processes.values());
    return {
      total: processes.length,
      running: processes.filter((p) => p.status === 'running').length,
      completed: processes.filter((p) => p.status === 'completed').length,
      failed: processes.filter((p) => p.status === 'failed').length,
      killed: processes.filter((p) => p.status === 'killed').length,
    };
  }

  /**
   * Clear old completed/failed processes (garbage collection).
   */
  gc(maxAgeMs = 3600000): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, proc] of this.processes) {
      if (proc.status !== 'running' && now - proc.startTime > maxAgeMs) {
        this.processes.delete(id);
        this.childProcesses.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug({ removed }, 'GC cleaned up old processes');
    }
    return removed;
  }

  /**
   * Destroy all running processes (for graceful shutdown).
   * Kills all running processes with SIGTERM.
   * @returns Object with count of killed processes and any errors
   */
  destroyAll(): { killed: number; errors: string[] } {
    const running = Array.from(this.processes.values()).filter((p) => p.status === 'running');
    let killed = 0;
    const errors: string[] = [];

    logger.info({ count: running.length }, 'Destroying all background processes');

    for (const proc of running) {
      const result = this.kill(proc.id, 'SIGTERM');
      if (result.success) {
        killed++;
      } else {
        errors.push(result.message);
      }
    }

    logger.info({ killed, errors: errors.length }, 'Background processes destroyed');
    return { killed, errors };
  }
}

// Singleton instance
let globalRegistry: ProcessRegistry | null = null;

export function getProcessRegistry(config?: Partial<ProcessRegistryConfig>): ProcessRegistry {
  if (!globalRegistry) {
    globalRegistry = new ProcessRegistry(config);
  }
  return globalRegistry;
}

export function resetProcessRegistry(): void {
  globalRegistry = null;
}

export { ProcessRegistry };
export default ProcessRegistry;

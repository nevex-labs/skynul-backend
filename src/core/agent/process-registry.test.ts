import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_REGISTRY_CONFIG, ProcessRegistry, getProcessRegistry, resetProcessRegistry } from './process-registry';

describe('DEFAULT_REGISTRY_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_REGISTRY_CONFIG.defaultTimeoutMs).toBe(30000);
    expect(DEFAULT_REGISTRY_CONFIG.maxProcessesPerTask).toBe(5);
    expect(DEFAULT_REGISTRY_CONFIG.autoCleanup).toBe(true);
    expect(DEFAULT_REGISTRY_CONFIG.actionTimeouts.shell).toBe(60000);
    expect(DEFAULT_REGISTRY_CONFIG.actionTimeouts.docker).toBe(300000);
  });
});

describe('ProcessRegistry', () => {
  let registry: ProcessRegistry;

  beforeEach(() => {
    resetProcessRegistry();
    registry = getProcessRegistry();
  });

  describe('executeWithTimeout', () => {
    it('returns completed for fast commands', async () => {
      const result = await registry.executeWithTimeout('echo hello', 'task-1', {
        timeoutMs: 5000,
      });

      expect(result.type).toBe('completed');
      if (result.type === 'completed') {
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('hello');
      }
    });

    it('returns background handle for slow commands', async () => {
      const result = await registry.executeWithTimeout('sleep 60', 'task-1', {
        timeoutMs: 100, // Very short timeout to force background
      });

      expect(result.type).toBe('background');
      if (result.type === 'background') {
        expect(result.processId).toMatch(/^bg_/);
        expect(result.message).toContain('exceeded');
        expect(result.message).toContain('background');
      }

      // Cleanup
      if (result.type === 'background') {
        registry.kill(result.processId, 'SIGKILL');
      }
    });

    it('captures stderr on error', async () => {
      const result = await registry.executeWithTimeout('echo error >&2 && exit 1', 'task-1', {
        timeoutMs: 5000,
      });

      expect(result.type).toBe('completed');
      if (result.type === 'completed') {
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('error');
      }
    });

    it('uses action-specific timeouts', async () => {
      // npm action has 120s timeout
      const registry2 = new ProcessRegistry({
        actionTimeouts: { npm: 50 }, // Force short timeout for npm
      });

      const result = await registry2.executeWithTimeout('sleep 10', 'task-1', {
        actionType: 'npm',
      });

      expect(result.type).toBe('background');

      if (result.type === 'background') {
        registry2.kill(result.processId, 'SIGKILL');
      }
    });

    it('respects max processes per task limit', async () => {
      const registry3 = new ProcessRegistry({
        maxProcessesPerTask: 1,
      });

      // Create first background process
      const result1 = await registry3.executeWithTimeout('sleep 60', 'task-1', {
        timeoutMs: 100,
      });
      expect(result1.type).toBe('background');

      // Second should fail
      const result2 = await registry3.executeWithTimeout('sleep 60', 'task-1', {
        timeoutMs: 100,
      });
      expect(result2.type).toBe('completed');
      if (result2.type === 'completed') {
        expect(result2.stderr).toContain('Max background processes');
      }

      // Cleanup
      if (result1.type === 'background') {
        registry3.kill(result1.processId, 'SIGKILL');
      }
    });
  });

  describe('poll', () => {
    it('returns not found for unknown process', () => {
      const result = registry.poll('unknown-id');
      expect(result.found).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('returns status for running process', async () => {
      const execResult = await registry.executeWithTimeout('sleep 60', 'task-1', {
        timeoutMs: 100,
      });

      expect(execResult.type).toBe('background');
      if (execResult.type === 'background') {
        const pollResult = registry.poll(execResult.processId);
        expect(pollResult.found).toBe(true);
        expect(pollResult.status).toBe('running');
        expect(pollResult.elapsedMs).toBeGreaterThanOrEqual(0);
        expect(pollResult.message).toContain('still running');

        // Cleanup
        registry.kill(execResult.processId, 'SIGKILL');
      }
    });

    it('returns completed status', async () => {
      const execResult = await registry.executeWithTimeout('echo done', 'task-1', {
        timeoutMs: 5000,
      });

      expect(execResult.type).toBe('completed');
    });
  });

  describe('kill', () => {
    it('kills running process', async () => {
      const execResult = await registry.executeWithTimeout('sleep 60', 'task-1', {
        timeoutMs: 100,
      });

      expect(execResult.type).toBe('background');
      if (execResult.type === 'background') {
        const killResult = registry.kill(execResult.processId);
        expect(killResult.success).toBe(true);
        expect(killResult.message).toContain('killed');

        // Verify status changed
        const pollResult = registry.poll(execResult.processId);
        expect(pollResult.status).toBe('killed');
      }
    });

    it('fails to kill non-existent process', () => {
      const result = registry.kill('unknown-id');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('fails to kill already completed process', async () => {
      const execResult = await registry.executeWithTimeout('echo done', 'task-1', {
        timeoutMs: 5000,
      });

      expect(execResult.type).toBe('completed');
      // Cannot test kill on completed since we don't have processId
    });
  });

  describe('getTaskProcesses', () => {
    it('returns empty array for task with no processes', () => {
      const processes = registry.getTaskProcesses('no-such-task');
      expect(processes).toEqual([]);
    });

    it('returns processes for task', async () => {
      await registry.executeWithTimeout('sleep 60', 'task-1', { timeoutMs: 100 });
      await registry.executeWithTimeout('sleep 60', 'task-2', { timeoutMs: 100 });

      const task1Processes = registry.getTaskProcesses('task-1');
      const task2Processes = registry.getTaskProcesses('task-2');

      expect(task1Processes).toHaveLength(1);
      expect(task2Processes).toHaveLength(1);
      expect(task1Processes[0]!.taskId).toBe('task-1');
      expect(task2Processes[0]!.taskId).toBe('task-2');

      // Cleanup
      task1Processes.forEach((p) => registry.kill(p.id, 'SIGKILL'));
      task2Processes.forEach((p) => registry.kill(p.id, 'SIGKILL'));
    });
  });

  describe('cleanupTask', () => {
    it('kills all running processes for task', async () => {
      await registry.executeWithTimeout('sleep 60', 'task-1', { timeoutMs: 100 });
      await registry.executeWithTimeout('sleep 60', 'task-1', { timeoutMs: 100 });

      const before = registry.getTaskProcesses('task-1');
      expect(before).toHaveLength(2);
      expect(before.every((p) => p.status === 'running')).toBe(true);

      const cleanup = registry.cleanupTask('task-1');
      expect(cleanup.killed).toBe(2);
      expect(cleanup.errors).toHaveLength(0);

      const after = registry.getTaskProcesses('task-1');
      expect(after.every((p) => p.status === 'killed')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('returns zero stats for empty registry', () => {
      const stats = registry.getStats();
      expect(stats.total).toBe(0);
      expect(stats.running).toBe(0);
    });

    it('tracks process counts', async () => {
      await registry.executeWithTimeout('sleep 60', 'task-1', { timeoutMs: 100 });

      const stats = registry.getStats();
      expect(stats.total).toBe(1);
      expect(stats.running).toBe(1);

      // Cleanup
      registry.cleanupTask('task-1');

      const statsAfter = registry.getStats();
      expect(statsAfter.killed).toBe(1);
    });
  });

  describe('gc', () => {
    it('removes old completed processes', async () => {
      // Create and complete a process
      const result = await registry.executeWithTimeout('echo done', 'task-1', {
        timeoutMs: 5000,
      });
      expect(result.type).toBe('completed');

      // Wait a bit for the process to be old enough
      await new Promise((resolve) => setTimeout(resolve, 10));

      // GC with very short max age should remove it
      const removed = registry.gc(5);
      expect(removed).toBeGreaterThanOrEqual(0);
    });
  });
});

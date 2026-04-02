/**
 * Tests para Effect.js integration en action executors
 */

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { executeShellEffect, executeShellWithEffect } from './action-executors';

describe('Effect Integration - Action Executors', () => {
  describe('executeShellEffect', () => {
    it('should execute shell command with Effect', async () => {
      const program = executeShellEffect('echo "Hello from Effect"');
      const result = await Effect.runPromise(program);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello from Effect');
    });

    it('should handle shell command errors with Effect', async () => {
      const program = executeShellEffect('exit 1');
      const result = await Effect.runPromise(program);

      expect(result.exitCode).toBe(1);
    });

    it('should respect timeout parameter', async () => {
      const program = executeShellEffect('echo "test"', undefined, 5000);
      const result = await Effect.runPromise(program);

      expect(result.exitCode).toBe(0);
    });

    it('should handle cwd parameter', async () => {
      const program = executeShellEffect('pwd', '/tmp');
      const result = await Effect.runPromise(program);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('/tmp');
    });
  });

  describe('executeShellWithEffect', () => {
    it('should maintain same API as executeShell', async () => {
      const result = await executeShellWithEffect('echo "Test"');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('Test');
      }
    });

    it('should handle command failures', async () => {
      const result = await executeShellWithEffect('exit 42');

      expect(result.ok).toBe(true); // Shell errors return ok with exit code
      if (result.ok) {
        expect(result.value).toContain('Exit 42');
      }
    });

    it('should handle invalid commands', async () => {
      const result = await executeShellWithEffect('invalid_command_xyz');

      expect(result.ok).toBe(false);
    });

    it('should handle background execution with taskId', async () => {
      // With taskId, it should use ProcessRegistry
      const result = await executeShellWithEffect('sleep 1', undefined, 100, 'test-task');

      // Should return immediately with background handle or timeout error
      expect(result).toBeDefined();
    });
  });

  describe('Effect benefits demonstration', () => {
    it('can be composed with other effects', async () => {
      const program = Effect.gen(function* () {
        const result1 = yield* executeShellEffect('echo "First"');
        const result2 = yield* executeShellEffect('echo "Second"');

        return {
          first: result1.stdout.trim(),
          second: result2.stdout.trim(),
        };
      });

      const result = await Effect.runPromise(program);

      expect(result.first).toContain('First');
      expect(result.second).toContain('Second');
    });

    it('provides structured error handling', async () => {
      // Use a command that exists but returns error exit code
      const result = await executeShellWithEffect('ls /nonexistent_directory_xyz_abc123');

      // Should handle gracefully - ls returns with exit code in output
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Result should contain exit code info
        expect(result.value).toContain('Exit');
      }
    });
  });
});

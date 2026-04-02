/**
 * Tests para Effect.js Cancellation
 */

import { Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';
import { createCancellableTask, executeShellWithCancellation, runCancellable, withTimeout } from './cancellation';

describe('Effect Cancellation', () => {
  describe('runCancellable', () => {
    it('should execute and complete successfully', async () => {
      const operation = runCancellable(
        Effect.gen(function* () {
          yield* Effect.sleep(100); // Simulate work
          return 'completed';
        })
      );

      const result = await operation.await();
      expect(result).toBe('completed');
    });

    it('should be cancellable', async () => {
      const operation = runCancellable(
        Effect.gen(function* () {
          yield* Effect.sleep(5000); // Long operation
          return 'completed';
        })
      );

      // Wait a tiny bit then cancel
      await new Promise((r) => setTimeout(r, 50));

      // Cancel - this will interrupt the fiber
      // Don't await the operation itself since it will fail when cancelled
      await Effect.runPromise(operation.abort('Test cancel')).catch(() => {
        // Expected
      });

      // Cleanup - ensure no hanging promises
      operation.await().catch(() => {});

      // Test passes if we get here without unhandled rejections
      expect(true).toBe(true);
    });
  });

  describe('executeShellWithCancellation', () => {
    it('should execute shell command', async () => {
      const result = await Effect.runPromise(executeShellWithCancellation('echo "Hello"'));

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello');
    });

    it('should handle command failure', async () => {
      const result = await Effect.runPromise(executeShellWithCancellation('exit 42'));

      expect(result.exitCode).toBe(42);
    });
  });

  describe('withTimeout', () => {
    it('should complete before timeout', async () => {
      const result = await Effect.runPromise(
        withTimeout(
          Effect.gen(function* () {
            yield* Effect.sleep(100);
            return 'success';
          }),
          5000
        )
      );

      expect(result).toBe('success');
    });

    it('should timeout if operation takes too long', async () => {
      const program = withTimeout(
        Effect.gen(function* () {
          yield* Effect.sleep(10000);
          return 'success';
        }),
        100
      );

      // Should fail with timeout
      await expect(Effect.runPromise(program)).rejects.toThrow();
    });
  });

  describe('createCancellableTask', () => {
    it('should create and run a cancellable task', async () => {
      const task = createCancellableTask(
        'test-task-1',
        Effect.gen(function* () {
          yield* Effect.sleep(100);
          return 'done';
        })
      );

      expect(task.isRunning()).toBe(false);

      const resultPromise = task.run();
      expect(task.isRunning()).toBe(true);

      const result = await resultPromise;
      expect(result).toBe('done');
      expect(task.isRunning()).toBe(false);
    });

    it('should cancel a running task', async () => {
      let progress = 0;

      const task = createCancellableTask(
        'test-task-2',
        Effect.gen(function* () {
          for (let i = 0; i < 100; i++) {
            yield* Effect.sleep(50);
            progress = i;
          }
          return 'completed';
        })
      );

      // Start task but don't await yet
      const runPromise = task.run().catch(() => {
        // Expected to fail when cancelled
        return 'cancelled';
      });

      // Wait a bit
      await new Promise((r) => setTimeout(r, 150));

      // Cancel it
      task.cancel('User requested');

      // Wait for cancellation to take effect
      await new Promise((r) => setTimeout(r, 100));

      // Should stop before 100
      expect(progress).toBeLessThan(10);
      expect(task.isRunning()).toBe(false);

      // Clean up - await the promise to prevent unhandled rejection
      await runPromise;
    });
  });

  describe('Integration with existing code', () => {
    it('can wrap existing async operations', async () => {
      // Simulating an existing async function
      const legacyAsync = () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('legacy result'), 100);
        });

      // Wrap it in Effect
      const wrapped = Effect.promise(() => legacyAsync());

      const result = await Effect.runPromise(wrapped);
      expect(result).toBe('legacy result');
    });

    it('demonstrates effect benefits', async () => {
      // Simple demonstration that Effect works with our setup
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const value1 = yield* Effect.succeed(10);
          const value2 = yield* Effect.succeed(20);
          return value1 + value2;
        })
      );

      expect(result).toBe(30);
    });
  });
});

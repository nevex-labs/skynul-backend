/**
 * Tests para Effect services
 */

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { AppLayerTest, TaskConfigService, TaskLoggerService, ToolExecutionError, runEffectTest } from './services';

describe('Effect Services', () => {
  describe('TaskLoggerService', () => {
    it('should log messages without errors', async () => {
      const program = Effect.gen(function* () {
        const logger = yield* TaskLoggerService;
        yield* logger.info('Test message');
        yield* logger.debug('Debug message');
        yield* logger.warn('Warning message');
        yield* logger.error('Error message', new Error('Test error'));
        return 'logged';
      });

      const result = await runEffectTest(program);
      expect(result).toBe('logged');
    });
  });

  describe('TaskConfigService', () => {
    it('should provide config values', async () => {
      const program = Effect.gen(function* () {
        const config = yield* TaskConfigService;
        const maxSteps = yield* config.getMaxSteps;
        const timeout = yield* config.getTimeout;
        return { maxSteps, timeout };
      });

      const result = await runEffectTest(program);
      expect(result.maxSteps).toBe(200);
      expect(result.timeout).toBe(30000);
    });
  });

  describe('Error handling', () => {
    it('should catch and handle errors', async () => {
      const program = Effect.gen(function* () {
        const result = yield* Effect.fail(new ToolExecutionError('test', 'Something went wrong')).pipe(
          Effect.catchTag('ToolExecutionError', (e) => Effect.succeed(`Recovered from: ${e.message}`))
        );
        return result;
      });

      const result = await runEffectTest(program);
      expect(result).toBe('Recovered from: Something went wrong');
    });

    it('should handle successful operations', async () => {
      const program = Effect.gen(function* () {
        const result = yield* Effect.succeed('success');
        return result;
      });

      const result = await runEffectTest(program);
      expect(result).toBe('success');
    });
  });

  describe('Composition', () => {
    it('should compose multiple effects', async () => {
      const program = Effect.gen(function* () {
        const logger = yield* TaskLoggerService;
        const config = yield* TaskConfigService;

        yield* logger.info('Starting composition');
        const timeout = yield* config.getTimeout;
        yield* logger.info('Got timeout', { timeout });

        return timeout;
      });

      const result = await runEffectTest(program);
      expect(result).toBe(30000);
    });
  });
});

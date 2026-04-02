/**
 * Effect Services - Implementación real de Effect.js v3.x
 *
 * Este módulo provee servicios base usando Effect.
 * Es el punto de entrada para la adopción incremental.
 */

import { Context, Effect, Layer, Schedule } from 'effect';

// ============================================================================
// LOGGER SERVICE
// ============================================================================

export interface TaskLoggerService {
  readonly debug: (message: string, context?: object) => Effect.Effect<void>;
  readonly info: (message: string, context?: object) => Effect.Effect<void>;
  readonly warn: (message: string, context?: object) => Effect.Effect<void>;
  readonly error: (message: string, error?: Error, context?: object) => Effect.Effect<void>;
}

export const TaskLoggerService = Context.GenericTag<TaskLoggerService>('@skynul/TaskLoggerService');

// Live implementation
export const TaskLoggerLive = Layer.succeed(TaskLoggerService, {
  debug: (message, context) =>
    Effect.sync(() => {
      console.debug(`[DEBUG] ${message}`, context || '');
    }),
  info: (message, context) =>
    Effect.sync(() => {
      console.info(`[INFO] ${message}`, context || '');
    }),
  warn: (message, context) =>
    Effect.sync(() => {
      console.warn(`[WARN] ${message}`, context || '');
    }),
  error: (message, error, context) =>
    Effect.sync(() => {
      console.error(`[ERROR] ${message}`, error?.message || '', context || '');
    }),
});

// Test implementation (silent)
export const TaskLoggerTest = Layer.succeed(TaskLoggerService, {
  debug: () => Effect.void,
  info: () => Effect.void,
  warn: () => Effect.void,
  error: () => Effect.void,
});

// ============================================================================
// CONFIG SERVICE
// ============================================================================

export interface TaskConfig {
  readonly maxSteps: number;
  readonly timeoutMs: number;
  readonly provider: string;
}

export interface TaskConfigService {
  readonly get: Effect.Effect<TaskConfig>;
  readonly getMaxSteps: Effect.Effect<number>;
  readonly getTimeout: Effect.Effect<number>;
}

export const TaskConfigService = Context.GenericTag<TaskConfigService>('@skynul/TaskConfigService');

export const makeTaskConfigLive = (config: TaskConfig) =>
  Layer.succeed(TaskConfigService, {
    get: Effect.succeed(config),
    getMaxSteps: Effect.succeed(config.maxSteps),
    getTimeout: Effect.succeed(config.timeoutMs),
  });

// Default config
export const TaskConfigLive = makeTaskConfigLive({
  maxSteps: 200,
  timeoutMs: 30000,
  provider: 'chatgpt',
});

// ============================================================================
// ERROR TYPES
// ============================================================================

export class ToolTimeoutError {
  readonly _tag = 'ToolTimeoutError';
  constructor(
    readonly tool: string,
    readonly timeoutMs: number
  ) {}
}

export class ToolExecutionError {
  readonly _tag = 'ToolExecutionError';
  constructor(
    readonly tool: string,
    readonly message: string,
    readonly cause?: unknown
  ) {}
}

export class ValidationError {
  readonly _tag = 'ValidationError';
  constructor(
    readonly field: string,
    readonly message: string
  ) {}
}

// ============================================================================
// RETRY POLICY
// ============================================================================

export const defaultRetryPolicy = Schedule.recurs(3).pipe(Schedule.andThen(Schedule.exponential(1000)));

export const aggressiveRetryPolicy = Schedule.recurs(5).pipe(Schedule.andThen(Schedule.exponential(500)));

// ============================================================================
// HELPERS
// ============================================================================

export const withTimeout = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  timeoutMs: number
): Effect.Effect<A, E | ToolTimeoutError, R> =>
  effect.pipe(
    Effect.timeout(timeoutMs),
    Effect.catchAll((e) => Effect.fail(new ToolTimeoutError('unknown', timeoutMs)))
  );

export const withLogging = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  operation: string
): Effect.Effect<A, E, R | TaskLoggerService> =>
  Effect.gen(function* () {
    const logger = yield* TaskLoggerService;
    yield* logger.info(`Starting: ${operation}`);

    const result = yield* effect.pipe(
      Effect.tapBoth({
        onSuccess: () => logger.info(`Completed: ${operation}`),
        onFailure: (e) => logger.error(`Failed: ${operation}`, e as Error),
      })
    );

    return result;
  });

// ============================================================================
// APP LAYER (Combinación de todos los servicios)
// ============================================================================

export const AppLayer = Layer.merge(TaskLoggerLive, TaskConfigLive);

export const AppLayerTest = Layer.merge(TaskLoggerTest, TaskConfigLive);

// ============================================================================
// RUNTIME
// ============================================================================

export const runEffect = <A, E>(effect: Effect.Effect<A, E, TaskLoggerService | TaskConfigService>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(AppLayer)));

export const runEffectTest = <A, E>(effect: Effect.Effect<A, E, TaskLoggerService | TaskConfigService>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(AppLayerTest)));

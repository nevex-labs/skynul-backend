/**
 * Task Cancellation con Effect.js Fibers
 *
 * Effect proporciona cancelación automática de fibers.
 * Cuando un task se cancela, TODOS los efectos hijos se cancelan.
 * Esto incluye:
 * - Shell commands en ejecución
 * - LLM calls pendientes
 * - Timers y timeouts
 * - Procesos background
 *
 * Benefits:
 * - No más procesos huerfanos
 * - Cleanup automático garantizado
 * - Cancelación graceful (SIGTERM antes que SIGKILL)
 */

import type { ChildProcess } from 'child_process';
import { Effect, Fiber, Scope } from 'effect';

export type CancellableOperation<T, E = Error> = {
  fiber: Fiber.RuntimeFiber<T, E>;
  abort: (reason?: string) => Effect.Effect<void>;
  await: () => Promise<T>;
};

/**
 * Ejecutar una operación con soporte de cancelación
 *
 * @example
 * ```typescript
 * const operation = runCancellable(
 *   Effect.gen(function* () {
 *     const result = yield* executeShellEffect('long-running-command');
 *     return result;
 *   })
 * );
 *
 * // Cancelar después de 5 segundos
 * setTimeout(() => {
 *   Effect.runPromise(operation.abort('Timeout'));
 * }, 5000);
 *
 * const result = await operation.await();
 * ```
 */
export const runCancellable = <T, E = Error>(effect: Effect.Effect<T, E, never>): CancellableOperation<T, E> => {
  // Crear un scope para el fiber
  // Cuando el scope se cierra, todos los recursos se liberan
  let fiberRef: Fiber.RuntimeFiber<T, E>;

  const program = Effect.gen(function* () {
    fiberRef = yield* Effect.fork(effect);
    return yield* Fiber.join(fiberRef);
  });

  const runtime = Effect.runPromise(program);

  return {
    get fiber() {
      return fiberRef!;
    },
    abort: (reason = 'Cancelled') =>
      Effect.gen(function* () {
        if (fiberRef) {
          yield* Fiber.interrupt(fiberRef);
        }
      }),
    await: () => runtime,
  };
};

/**
 * Shell execution con cancelación
 *
 * Envuelve un ChildProcess en un Effect cancelable
 */
export const executeShellWithCancellation = (
  command: string,
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  } = {}
): Effect.Effect<{ exitCode: number | null; stdout: string; stderr: string }, Error, never> =>
  Effect.async((resume) => {
    const { spawn } = require('child_process');

    const child = spawn(command, {
      shell: true,
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('exit', (exitCode) => {
      resume(Effect.succeed({ exitCode, stdout, stderr }));
    });

    child.on('error', (error) => {
      resume(Effect.fail(error));
    });

    // Setup timeout if specified
    if (options.timeout) {
      setTimeout(() => {
        child.kill('SIGTERM');
      }, options.timeout);
    }

    // Return cleanup function (called on cancellation)
    return Effect.sync(() => {
      if (!child.killed) {
        child.kill('SIGTERM');
        // Force kill after grace period
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }
    });
  });

/**
 * Timeout con Effect
 *
 * Automáticamente cancela el efecto si excede el tiempo
 */
export const withTimeout = <T, E>(
  effect: Effect.Effect<T, E, never>,
  timeoutMs: number,
  onTimeout?: () => void
): Effect.Effect<T, E | Error, never> =>
  effect.pipe(
    Effect.timeout(timeoutMs),
    Effect.catchAll((e) => {
      if (onTimeout) onTimeout();
      return Effect.fail(new Error(`Operation timed out after ${timeoutMs}ms`));
    })
  );

/**
 * Ejecutar múltiples operaciones con cancelación en grupo
 *
 * Si una falla o se cancela, todas se cancelan
 */
export const runAllCancellable = <T, E>(
  effects: Effect.Effect<T, E, never>[],
  options: {
    concurrency?: number;
    onComplete?: (results: T[]) => void;
    onError?: (error: E) => void;
  } = {}
): Effect.Effect<T[], E, never> =>
  Effect.gen(function* () {
    // Ejecutar con concurrencia limitada
    const results = yield* Effect.forEach(effects, (effect) => effect, {
      concurrency: options.concurrency ?? effects.length,
    });

    if (options.onComplete) {
      options.onComplete(results);
    }

    return results;
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        if (options.onError) options.onError(error);
      })
    )
  );

/**
 * Integration con TaskManager
 *
 * Reemplaza el sistema de cancelación actual
 */
export const createCancellableTask = <T, E = Error>(
  taskId: string,
  effect: Effect.Effect<T, E, never>
): {
  run: () => Promise<T>;
  cancel: (reason?: string) => void;
  isRunning: () => boolean;
} => {
  let fiber: Fiber.RuntimeFiber<T, E> | null = null;
  let running = false;

  return {
    run: async () => {
      running = true;
      const program = Effect.gen(function* () {
        fiber = yield* Effect.fork(effect);
        const result = yield* Fiber.join(fiber);
        return result;
      });

      try {
        const result = await Effect.runPromise(program);
        running = false;
        return result;
      } catch (e) {
        running = false;
        throw e;
      }
    },
    cancel: (reason = 'Cancelled by user') => {
      if (fiber && running) {
        Effect.runPromise(Fiber.interrupt(fiber));
        console.log(`[Task ${taskId}] Cancelled: ${reason}`);
      }
    },
    isRunning: () => running,
  };
};

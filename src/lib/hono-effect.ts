import { Effect, Exit, Layer, ManagedRuntime } from 'effect';
import type { Context as HonoContext } from 'hono';

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export type HttpErrorBody = { error: string; code?: string };

export type EffectHandler<C extends HonoContext = HonoContext> = (c: C) => Effect.Effect<HttpResponse, never, any>;

/**
 * Memo map global — asegura que los Layers scoped se evalúen una sola vez
 * aunque se llame desde múltiples archivos de rutas.
 */
let _memoMap: Layer.MemoMap | null = null;
const _runtimes = new Map<string, ManagedRuntime.ManagedRuntime<any, any>>();

async function getMemoMap(): Promise<Layer.MemoMap> {
  if (!_memoMap) {
    _memoMap = await Effect.runPromise(Layer.makeMemoMap);
  }
  return _memoMap;
}

/**
 * Extrae un mensaje legible de un Effect Cause
 */
function extractErrorMessage(cause: unknown): string {
  if (cause && typeof cause === 'object' && '_tag' in cause) {
    const c = cause as Record<string, unknown>;
    if (c.failure && typeof c.failure === 'object') {
      const f = c.failure as Record<string, unknown>;
      if (f.message) return String(f.message);
      if (f._op === 'MissingData' && f.path) return `Missing config: ${JSON.stringify(f.path)}`;
    }
    if (c.left) return extractErrorMessage(c.left);
  }
  return 'Internal server error';
}

/**
 * Crea un adapter que convierte handlers de Effect a handlers de Hono.
 *
 * Acepta un Layer y crea un runtime singleton internamente.
 * El runtime se comparte entre todos los handlers que usen el mismo Layer.
 * Los scoped resources (DB pool) se crean una vez y viven hasta shutdown.
 */
export function createEffectRoute(layer: Layer.Layer<any, any, never>) {
  // Key única para este layer (basada en referencia)
  const layerKey = String(layer);

  let runtimePromise: Promise<ManagedRuntime.ManagedRuntime<any, any>> | null = null;

  function getRuntime(): Promise<ManagedRuntime.ManagedRuntime<any, any>> {
    if (!_runtimes.has(layerKey)) {
      runtimePromise ??= getMemoMap()
        .then((memoMap) => {
          const runtime = ManagedRuntime.make(layer, memoMap);
          _runtimes.set(layerKey, runtime);
          return runtime;
        })
        .catch((err) => {
          console.error('❌ Failed to initialize Effect runtime:', err instanceof Error ? err.message : String(err));
          throw err;
        });
      return runtimePromise!;
    }
    return Promise.resolve(_runtimes.get(layerKey)!);
  }

  return function effectHandler(handler: EffectHandler<HonoContext>): (c: HonoContext) => Promise<Response> {
    return async (c: HonoContext) => {
      const runtime = await getRuntime();
      const program = handler(c);
      const exit = await runtime.runPromiseExit(program);

      if (Exit.isSuccess(exit)) {
        const { status, body, headers } = exit.value;

        if (headers) {
          Object.entries(headers).forEach(([key, value]) => {
            c.header(key, value);
          });
        }

        return c.json(body, status as any);
      }

      console.error('❌ Unhandled Effect error:', exit.cause);
      const errorMessage = extractErrorMessage(exit.cause);
      return c.json({ error: errorMessage }, 500);
    };
  };
}

/**
 * Dispose todos los runtimes (para graceful shutdown).
 */
export async function disposeAllRuntimes(): Promise<void> {
  for (const runtime of _runtimes.values()) {
    runtime.dispose();
  }
  _runtimes.clear();
}

export const Http = {
  ok: (body: unknown): HttpResponse => ({ status: 200, body }),
  created: (body: unknown): HttpResponse => ({ status: 201, body }),
  noContent: (): HttpResponse => ({ status: 204, body: null }),
  badRequest: (message: string, code?: string): HttpResponse => ({
    status: 400,
    body: { error: message, ...(code ? { code } : {}) },
  }),
  unauthorized: (): HttpResponse => ({
    status: 401,
    body: { error: 'Unauthorized' },
  }),
  notFound: (resource?: string, code?: string): HttpResponse => ({
    status: 404,
    body: { error: resource ? `${resource} not found` : 'Not found', ...(code ? { code } : {}) },
  }),
  conflict: (message: string): HttpResponse => ({
    status: 409,
    body: { error: message },
  }),
  internalError: (message = 'Internal server error'): HttpResponse => ({
    status: 500,
    body: { error: message },
  }),
};

import { execSync } from 'child_process';
import { Effect } from 'effect';
import { Hono } from 'hono';
import { AppLayer } from '../../config/layers';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Ollama error:', error);
  return Http.internalError();
};

const ollama = new Hono()
  .get(
    '/ping',
    handler((c) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: async () => {
            const res = await fetch('http://localhost:11434/api/tags', {
              signal: AbortSignal.timeout(3000),
            });
            if (!res.ok) throw new Error('Ollama not responding');
            return res;
          },
          catch: (error) => new Error(String(error)),
        });

        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(Http.ok({ error: 'Ollama not running' }))))
    )
  )
  .get(
    '/installed',
    handler((c) =>
      Effect.sync(() => {
        try {
          // Check if ollama command exists
          execSync('which ollama', { stdio: 'ignore' });
          return Http.ok({ installed: true });
        } catch {
          // Also check for Windows
          try {
            execSync('where ollama', { stdio: 'ignore' });
            return Http.ok({ installed: true });
          } catch {
            return Http.ok({ installed: false });
          }
        }
      })
    )
  )
  .get(
    '/models',
    handler((c) =>
      Effect.gen(function* () {
        const models = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch('http://localhost:11434/api/tags');
            if (!response.ok) throw new Error('Failed to fetch models');

            const data = (await response.json()) as { models?: Array<{ name: string }> };
            return data.models?.map((m) => m.name) || [];
          },
          catch: () => [],
        });

        return Http.ok(models);
      }).pipe(Effect.catchAll((error) => Effect.succeed(Http.ok([]))))
    )
  );

export { ollama };
export type OllamaRoute = typeof ollama;

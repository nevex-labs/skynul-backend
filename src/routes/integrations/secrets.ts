import { Effect } from 'effect';
import { Hono } from 'hono';
import { AppLayer } from '../../config/layers';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { SecretService } from '../../services/secrets';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Secret operation error:', error);
  if (error?._tag === 'SecretNotFoundError') {
    return Http.notFound(`Secret "${error.keyName}"`);
  }
  return Http.internalError();
};

function getUserId(c: any): number | null {
  return (c.get('jwtPayload') as any)?.userId ?? null;
}

const secrets = new Hono()
  .get(
    '/keys',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const service = yield* SecretService;
        const list = yield* service.list(userId);
        return Http.ok({ keys: list.map((s) => s.keyName) });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .get(
    '/:key',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const keyName = c.req.param('key') as string;
        const service = yield* SecretService;
        const value = yield* service.get(userId, keyName);
        return Http.ok({ value });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/:key',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const keyName = c.req.param('key') as string;
        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        if (!body?.value || typeof body.value !== 'string') {
          return Http.badRequest('value is required and must be a string');
        }

        const service = yield* SecretService;
        yield* service.set({ userId, keyName, value: body.value });
        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .get(
    '/:key/exists',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const keyName = c.req.param('key') as string;
        const service = yield* SecretService;

        const exists = yield* service.get(userId, keyName).pipe(
          Effect.map(() => true),
          Effect.catchAll((error) => {
            if (error?._tag === 'SecretNotFoundError') {
              return Effect.succeed(false);
            }
            return Effect.fail(error);
          })
        );

        return Http.ok({ exists });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .delete(
    '/:key',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const keyName = c.req.param('key') as string;
        const service = yield* SecretService;
        yield* service.delete(userId, keyName);
        return Http.noContent();
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  );

export { secrets };
export type SecretsRoute = typeof secrets;

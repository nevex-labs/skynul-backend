import { Effect } from 'effect';
import { Hono } from 'hono';
import { z } from 'zod';
import { AppLayer } from '../../config/layers';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { BrowserSnapshotService } from '../../services/browser/tag';
import { BrowserSnapshotNotFoundError } from '../../shared/errors';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Browser snapshot error:', error);
  if (error?._tag === 'BrowserSnapshotNotFoundError') {
    return Http.notFound(`Snapshot ${error.snapshotId}`);
  }
  return Http.internalError();
};

const snapshotSchema = z.object({ name: z.string().min(1) });

const browser = new Hono()
  .get(
    '/snapshots',
    handler((c) =>
      Effect.gen(function* () {
        const service = yield* BrowserSnapshotService;
        const snapshots = yield* service.list();
        const list = snapshots.map((s) => ({
          id: s.snapshotId,
          name: s.name,
          url: s.url,
          title: s.title,
          createdAt: s.createdAt?.getTime() ?? Date.now(),
        }));
        return Http.ok(list);
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .post(
    '/snapshots',
    handler((c) =>
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = snapshotSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* BrowserSnapshotService;
        yield* service.create(parsed.data.name, 'https://example.com', 'Example Page');
        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .post(
    '/snapshots/:id/restore',
    handler((c) =>
      Effect.gen(function* () {
        const snapshotId = c.req.param('id');
        if (!snapshotId) {
          return Http.badRequest('Snapshot ID required');
        }

        const service = yield* BrowserSnapshotService;
        yield* service.getById(snapshotId);
        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .delete(
    '/snapshots/:id',
    handler((c) =>
      Effect.gen(function* () {
        const snapshotId = c.req.param('id');
        if (!snapshotId) {
          return Http.badRequest('Snapshot ID required');
        }

        const service = yield* BrowserSnapshotService;
        yield* service.delete(snapshotId);
        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  );

export { browser };
export type BrowserRoute = typeof browser;

import { Effect } from 'effect';
import { Hono } from 'hono';
import { z } from 'zod';
import { AppLayer } from '../../config/layers';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { getJwtUserId } from '../../middleware/jwt';
import { ProjectService } from '../../services/projects/tag';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Project operation error:', error);
  if (error?._tag === 'ProjectNotFoundError') {
    return Http.notFound(`Project ${error.projectId}`);
  }
  return Http.internalError();
};

const createProjectSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional().default('#6366f1'),
});

const updateProjectSchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
});

const projectsRoute = new Hono()
  .get(
    '/',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getJwtUserId(c);
        if (userId == null) return Http.unauthorized();
        const service = yield* ProjectService;
        const list = yield* service.list(userId);
        return Http.ok({ projects: list });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .post(
    '/',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getJwtUserId(c);
        if (userId == null) return Http.unauthorized();
        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = createProjectSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* ProjectService;
        const project = yield* service.create(userId, parsed.data.name, parsed.data.color);
        return Http.created(project);
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/:id',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getJwtUserId(c);
        if (userId == null) return Http.unauthorized();
        const id = Number.parseInt(c.req.param('id') || '', 10);
        if (isNaN(id)) {
          return Http.badRequest('Invalid project ID');
        }

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = updateProjectSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* ProjectService;
        yield* service.update(userId, id, parsed.data.name, parsed.data.color);
        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .delete(
    '/:id',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getJwtUserId(c);
        if (userId == null) return Http.unauthorized();
        const id = Number.parseInt(c.req.param('id') || '', 10);
        if (isNaN(id)) {
          return Http.badRequest('Invalid project ID');
        }

        const service = yield* ProjectService;
        yield* service.delete(userId, id);
        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .post(
    '/:id/tasks/:taskId',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getJwtUserId(c);
        if (userId == null) return Http.unauthorized();
        const id = Number.parseInt(c.req.param('id') || '', 10);
        const taskId = c.req.param('taskId');
        if (isNaN(id) || !taskId) {
          return Http.badRequest('Invalid project ID or task ID');
        }

        const service = yield* ProjectService;
        yield* service.addTask(userId, id, taskId);
        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .delete(
    '/:id/tasks/:taskId',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getJwtUserId(c);
        if (userId == null) return Http.unauthorized();
        const id = Number.parseInt(c.req.param('id') || '', 10);
        const taskId = c.req.param('taskId');
        if (isNaN(id) || !taskId) {
          return Http.badRequest('Invalid project ID or task ID');
        }

        const service = yield* ProjectService;
        yield* service.removeTask(userId, id, taskId);
        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  );

export { projectsRoute as projects };
export type ProjectsRoute = typeof projectsRoute;

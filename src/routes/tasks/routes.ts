import { zValidator } from '@hono/zod-validator';
import { Effect } from 'effect';
import { Hono } from 'hono';
import { z } from 'zod';
import { AppLayer } from '../../config/layers';
import { getMetricsOverview, getTaskMetrics } from '../../core/agent/metrics';
import { inferTaskSetup } from '../../core/agent/task-inference';
import { TaskManager } from '../../core/agent/task-manager';
import { dispatchChat } from '../../core/providers/dispatch';
import { Http, type HttpResponse, createEffectRoute } from '../../lib/hono-effect';
import { DEFAULT_POLICY, TASK_CAPABILITY_IDS, type TaskCreateRequest, type TaskListResponse } from '../../shared/types';

const handler = createEffectRoute(AppLayer as any);

const tm = new TaskManager();
// TODO: Refactor TaskManager to support per-user policies from database
// For now, use DEFAULT_POLICY as the fallback
tm.setPolicyGetter(() => DEFAULT_POLICY);

/** Expose the TaskManager instance for use by other modules (e.g., channels). */
export { tm as taskManager };

const taskCapabilitySchema = z.enum(TASK_CAPABILITY_IDS);

const taskCreateSchema = z.object({
  prompt: z.string().min(1),
  capabilities: z.array(taskCapabilitySchema).optional(),
  attachments: z.array(z.string()).optional(),
  mode: z.enum(['browser', 'code']).optional(),
  infer: z.boolean().optional(),
  inferStrategy: z.enum(['auto', 'rules', 'llm']).optional(),
  maxSteps: z.number().optional(),
  timeoutMs: z.number().optional(),
  source: z.enum(['desktop', 'telegram', 'discord', 'slack', 'whatsapp', 'signal']).optional(),
  parentTaskId: z.string().optional(),
  agentName: z.string().optional(),
  agentRole: z.string().optional(),
  orchestrate: z.boolean().optional(),
  model: z.string().optional(),
  skipMemory: z.boolean().optional(),
});

const handleTaskError = (error: any): HttpResponse => {
  console.error('Task operation error:', error);
  return Http.badRequest(error instanceof Error ? error.message : String(error));
};

const tasks = new Hono()
  // POST /tasks/infer
  .post(
    '/infer',
    handler((c) =>
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        if (!body?.prompt) {
          return Http.badRequest('prompt is required');
        }

        const inferred = yield* Effect.tryPromise({
          try: () =>
            inferTaskSetup({
              input: { prompt: body.prompt, attachments: body.attachments },
              strategy: body.strategy,
              chat: (messages) => dispatchChat(DEFAULT_POLICY.provider.active, messages),
            }),
          catch: (error) => {
            throw error;
          },
        });

        return Http.ok(inferred);
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleTaskError(error))))
    )
  )

  // GET /tasks
  .get(
    '/',
    handler((c) =>
      Effect.sync(() => {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        const response: TaskListResponse = { tasks: tm.list(userId) };
        return Http.ok(response);
      })
    )
  )

  // GET /tasks/:id
  .get(
    '/:id',
    handler((c) =>
      Effect.sync(() => {
        const id = c.req.param('id');
        if (!id) {
          return Http.badRequest('Task ID is required');
        }
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        const task = tm.get(id);
        if (!task) {
          return Http.notFound('Task');
        }
        // Multi-user isolation: only allow access to own tasks
        if (userId !== undefined && task.userId !== undefined && task.userId !== userId) {
          return Http.notFound('Task');
        }
        return Http.ok(task);
      })
    )
  )

  // POST /tasks
  .post(
    '/',
    handler((c) =>
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = taskCreateSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const data = parsed.data;
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        const infer = data.infer ?? true;

        if (!infer && !data.mode) {
          return Http.badRequest('mode is required when infer=false');
        }

        const needsInference = infer && ((data.capabilities?.length ?? 0) === 0 || data.mode === undefined);

        const inferred = needsInference
          ? yield* Effect.tryPromise({
              try: () =>
                inferTaskSetup({
                  input: { prompt: data.prompt, attachments: data.attachments },
                  strategy: data.inferStrategy,
                  chat: (messages) => dispatchChat(DEFAULT_POLICY.provider.active, messages),
                }),
              catch: (error) => {
                throw error;
              },
            })
          : null;

        const capabilities =
          infer && (!data.capabilities || data.capabilities.length === 0)
            ? (inferred?.capabilities ?? [])
            : (data.capabilities ?? []);

        const mode = infer && !data.mode ? (inferred?.mode ?? 'browser') : (data.mode ?? 'browser');

        const req: TaskCreateRequest = {
          prompt: data.prompt,
          capabilities,
          attachments: data.attachments,
          mode,
          maxSteps: data.maxSteps,
          timeoutMs: data.timeoutMs,
          source: data.source,
          parentTaskId: data.parentTaskId,
          agentName: data.agentName,
          agentRole: data.agentRole,
          orchestrate: data.orchestrate,
          model: data.model,
          skipMemory: data.skipMemory,
          userId,
        } as any;

        console.log(`[task-create] capabilities=${JSON.stringify(capabilities)}, mode=${mode}`);

        const task = tm.create(req);
        const approved = yield* Effect.tryPromise({
          try: () => tm.approve(task.id),
          catch: (error) => {
            throw error;
          },
        });

        return Http.created({ task: approved });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleTaskError(error))))
    )
  )

  // POST /tasks/:id/approve
  .post(
    '/:id/approve',
    handler((c) =>
      Effect.gen(function* () {
        const id = c.req.param('id');
        if (!id) {
          return Http.badRequest('Task ID is required');
        }
        const task = yield* Effect.tryPromise({
          try: () => tm.approve(id),
          catch: (error) => {
            throw error;
          },
        });
        return Http.ok({ task });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleTaskError(error))))
    )
  )

  // POST /tasks/:id/cancel
  .post(
    '/:id/cancel',
    handler((c) =>
      Effect.sync(() => {
        const id = c.req.param('id');
        if (!id) {
          return Http.badRequest('Task ID is required');
        }
        try {
          const task = tm.cancel(id);
          return Http.ok({ task });
        } catch (error) {
          return handleTaskError(error);
        }
      })
    )
  )

  // DELETE /tasks/:id
  .delete(
    '/:id',
    handler((c) =>
      Effect.sync(() => {
        const id = c.req.param('id');
        if (!id) {
          return Http.badRequest('Task ID is required');
        }
        tm.delete(id);
        return Http.ok({ ok: true });
      })
    )
  )

  // POST /tasks/:id/message
  .post(
    '/:id/message',
    handler((c) =>
      Effect.gen(function* () {
        const id = c.req.param('id');
        if (!id) {
          return Http.badRequest('Task ID is required');
        }
        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        if (!body?.message || typeof body.message !== 'string') {
          return Http.badRequest('message is required');
        }

        try {
          tm.sendMessage(id, 'user', body.message);
          return Http.ok({ ok: true });
        } catch (error) {
          return handleTaskError(error);
        }
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleTaskError(error))))
    )
  )

  // POST /tasks/:id/resume
  .post(
    '/:id/resume',
    handler((c) =>
      Effect.gen(function* () {
        const id = c.req.param('id');
        if (!id) {
          return Http.badRequest('Task ID is required');
        }
        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        if (!body?.message || typeof body.message !== 'string') {
          return Http.badRequest('message is required');
        }

        const task = yield* Effect.tryPromise({
          try: () => tm.resume(id, body.message),
          catch: (error) => {
            throw error;
          },
        });

        return Http.ok({ task });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleTaskError(error))))
    )
  )

  // GET /tasks/:id/metrics
  .get(
    '/:id/metrics',
    handler((c) =>
      Effect.sync(() => {
        const id = c.req.param('id');
        if (!id) {
          return Http.badRequest('Task ID is required');
        }
        const metrics = getTaskMetrics(id);
        if (!metrics) {
          return Http.notFound('Metrics');
        }
        return Http.ok({ metrics });
      })
    )
  )

  // GET /tasks/metrics/overview
  .get(
    '/metrics/overview',
    handler((c) =>
      Effect.sync(() => {
        return Http.ok({ overview: getMetricsOverview() });
      })
    )
  );

export { tasks };
export type TasksRoute = typeof tasks;

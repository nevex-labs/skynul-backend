import { Effect } from 'effect';
import { Hono } from 'hono';
import { z } from 'zod';
import { AppLayer } from '../../config/layers';
import { Http, type HttpResponse, createEffectRoute } from '../../lib/hono-effect';
import { SchedulesService } from '../../services/schedules';
import type { ScheduleFrequency } from '../../types';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Schedule error:', error);
  return Http.internalError();
};

const scheduleSchema = z.object({
  id: z.string().optional(),
  prompt: z.string().min(1),
  capabilities: z.array(z.string()),
  mode: z.enum(['browser', 'code']),
  frequency: z.enum(['daily', 'weekly', 'custom']),
  cronExpr: z.string(),
  enabled: z.boolean().optional().default(true),
});

function createScheduleId(): string {
  return `sched_${Buffer.from(crypto.randomUUID())
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)}`;
}

function toApiSchedule(dbSchedule: any) {
  return {
    id: dbSchedule.scheduleId,
    taskId: dbSchedule.taskId || null,
    prompt: dbSchedule.prompt,
    frequency: dbSchedule.frequency,
    enabled: dbSchedule.enabled,
    nextRunAt: dbSchedule.nextRunAt ? new Date(dbSchedule.nextRunAt).getTime() : null,
    lastRunAt: dbSchedule.lastRunAt ? new Date(dbSchedule.lastRunAt).getTime() : null,
    lastStatus: dbSchedule.lastStatus || null,
    createdAt: dbSchedule.createdAt ? new Date(dbSchedule.createdAt).getTime() : Date.now(),
  };
}

const schedules = new Hono()
  .get(
    '/',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) return Http.unauthorized();

        const service = yield* SchedulesService;
        const list = yield* service.getSchedules(userId);
        return Http.ok({ schedules: list.map(toApiSchedule) });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .post(
    '/',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) return Http.unauthorized();

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = scheduleSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const data = parsed.data;
        const service = yield* SchedulesService;

        if (data.id) {
          const existing = yield* service.getSchedule(userId, data.id);
          if (!existing) {
            return Http.notFound('Schedule not found', 'SCHEDULE_NOT_FOUND');
          }

          const updated = yield* service.updateSchedule(userId, data.id, {
            prompt: data.prompt,
            capabilities: data.capabilities,
            mode: data.mode,
            frequency: data.frequency as ScheduleFrequency,
            cronExpr: data.cronExpr,
            enabled: data.enabled,
          });

          const list = yield* service.getSchedules(userId);
          return Http.ok({ schedules: list.map(toApiSchedule), updated: toApiSchedule(updated) });
        }

        const scheduleId = createScheduleId();
        const created = yield* service.createSchedule(userId, scheduleId, {
          prompt: data.prompt,
          capabilities: data.capabilities,
          mode: data.mode,
          frequency: data.frequency as ScheduleFrequency,
          cronExpr: data.cronExpr,
          enabled: data.enabled,
        });

        const list = yield* service.getSchedules(userId);
        return Http.ok({ schedules: list.map(toApiSchedule), created: toApiSchedule(created) });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .delete(
    '/:id',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) return Http.unauthorized();

        const id = c.req.param('id');
        if (!id) return Http.badRequest('Schedule ID is required');

        const service = yield* SchedulesService;
        yield* service.deleteSchedule(userId, id);
        const list = yield* service.getSchedules(userId);
        return Http.ok({ schedules: list.map(toApiSchedule) });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/:id/toggle',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) return Http.unauthorized();

        const id = c.req.param('id');
        if (!id) return Http.badRequest('Schedule ID is required');

        const service = yield* SchedulesService;
        const existing = yield* service.getSchedule(userId, id);
        if (!existing) {
          return Http.notFound('Schedule not found', 'SCHEDULE_NOT_FOUND');
        }

        yield* service.toggleSchedule(userId, id, !existing.enabled);
        const list = yield* service.getSchedules(userId);
        return Http.ok({ schedules: list.map(toApiSchedule) });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  );

export { schedules };
export type SchedulesRoute = typeof schedules;

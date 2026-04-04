import { and, eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { taskSchedules } from '../../infrastructure/db/schema';
import { DatabaseError } from '../../shared/errors';
import type { Schedule } from '../../shared/types/schedule';
import type { TaskCapabilityId } from '../../shared/types/task';
import { DatabaseService } from '../database/tag';
import { type ScheduleInput, SchedulesService } from './tag';

// Convert DB record to Schedule type
function toSchedule(dbRecord: typeof taskSchedules.$inferSelect): Schedule {
  return {
    id: dbRecord.scheduleId,
    prompt: dbRecord.prompt,
    capabilities: dbRecord.capabilities as TaskCapabilityId[],
    mode: dbRecord.mode as 'browser' | 'code',
    frequency: dbRecord.frequency as Schedule['frequency'],
    cronExpr: dbRecord.cronExpr,
    enabled: dbRecord.enabled,
    lastRunAt: dbRecord.lastRunAt ? new Date(dbRecord.lastRunAt).getTime() : null,
    nextRunAt: dbRecord.nextRunAt ? new Date(dbRecord.nextRunAt).getTime() : Date.now(),
    createdAt: new Date(dbRecord.createdAt || Date.now()).getTime(),
  };
}

export const SchedulesServiceLive = Layer.effect(
  SchedulesService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    return SchedulesService.of({
      getSchedules: (userId: number) =>
        Effect.tryPromise({
          try: async () => {
            const records = await db.select().from(taskSchedules).where(eq(taskSchedules.userId, userId));
            return records.map(toSchedule);
          },
          catch: (error) => new DatabaseError(error),
        }),

      getSchedule: (userId: number, scheduleId: string) =>
        Effect.tryPromise({
          try: async () => {
            const [record] = await db
              .select()
              .from(taskSchedules)
              .where(and(eq(taskSchedules.userId, userId), eq(taskSchedules.scheduleId, scheduleId)))
              .limit(1);
            return record ? toSchedule(record) : null;
          },
          catch: (error) => new DatabaseError(error),
        }),

      createSchedule: (userId: number, scheduleId: string, input: ScheduleInput) =>
        Effect.gen(function* () {
          const [record] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(taskSchedules)
                .values({
                  userId,
                  scheduleId,
                  prompt: input.prompt,
                  capabilities: input.capabilities,
                  mode: input.mode,
                  frequency: input.frequency,
                  cronExpr: input.cronExpr,
                  enabled: input.enabled ?? true,
                  nextRunAt: new Date(),
                })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return toSchedule(record);
        }),

      updateSchedule: (userId: number, scheduleId: string, input: Partial<ScheduleInput>) =>
        Effect.gen(function* () {
          const values: Partial<typeof taskSchedules.$inferInsert> = {
            updatedAt: new Date(),
          };

          if (input.prompt !== undefined) values.prompt = input.prompt;
          if (input.capabilities !== undefined) values.capabilities = input.capabilities;
          if (input.mode !== undefined) values.mode = input.mode;
          if (input.frequency !== undefined) values.frequency = input.frequency;
          if (input.cronExpr !== undefined) values.cronExpr = input.cronExpr;
          if (input.enabled !== undefined) values.enabled = input.enabled;

          const [record] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .update(taskSchedules)
                .set(values)
                .where(and(eq(taskSchedules.userId, userId), eq(taskSchedules.scheduleId, scheduleId)))
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return toSchedule(record);
        }),

      deleteSchedule: (userId: number, scheduleId: string) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .delete(taskSchedules)
              .where(and(eq(taskSchedules.userId, userId), eq(taskSchedules.scheduleId, scheduleId)));
          },
          catch: (error) => new DatabaseError(error),
        }),

      toggleSchedule: (userId: number, scheduleId: string, enabled: boolean) =>
        Effect.gen(function* () {
          const [record] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .update(taskSchedules)
                .set({ enabled, updatedAt: new Date() })
                .where(and(eq(taskSchedules.userId, userId), eq(taskSchedules.scheduleId, scheduleId)))
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return toSchedule(record);
        }),

      updateLastRun: (userId: number, scheduleId: string, timestamp: number) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(taskSchedules)
              .set({ lastRunAt: new Date(timestamp), updatedAt: new Date() })
              .where(and(eq(taskSchedules.userId, userId), eq(taskSchedules.scheduleId, scheduleId)));
          },
          catch: (error) => new DatabaseError(error),
        }),

      updateNextRun: (userId: number, scheduleId: string, timestamp: number) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .update(taskSchedules)
              .set({ nextRunAt: new Date(timestamp), updatedAt: new Date() })
              .where(and(eq(taskSchedules.userId, userId), eq(taskSchedules.scheduleId, scheduleId)));
          },
          catch: (error) => new DatabaseError(error),
        }),
    });
  })
);

// Layer para testing
export const SchedulesServiceTest = Layer.succeed(
  SchedulesService,
  SchedulesService.of({
    getSchedules: () => Effect.succeed([]),
    getSchedule: () => Effect.succeed(null),
    createSchedule: (userId, scheduleId, input) =>
      Effect.succeed({
        id: scheduleId,
        prompt: input.prompt,
        capabilities: input.capabilities as TaskCapabilityId[],
        mode: input.mode,
        frequency: input.frequency,
        cronExpr: input.cronExpr,
        enabled: input.enabled ?? true,
        lastRunAt: null,
        nextRunAt: Date.now(),
        createdAt: Date.now(),
      }),
    updateSchedule: (userId, scheduleId, input) =>
      Effect.succeed({
        id: scheduleId,
        prompt: input.prompt || '',
        capabilities: (input.capabilities || []) as TaskCapabilityId[],
        mode: input.mode || 'browser',
        frequency: input.frequency || 'daily',
        cronExpr: input.cronExpr || '0 9 * * *',
        enabled: input.enabled ?? true,
        lastRunAt: null,
        nextRunAt: Date.now(),
        createdAt: Date.now(),
      }),
    deleteSchedule: () => Effect.succeed(undefined),
    toggleSchedule: (userId, scheduleId, enabled) =>
      Effect.succeed({
        id: scheduleId,
        prompt: '',
        capabilities: [],
        mode: 'browser',
        frequency: 'daily',
        cronExpr: '0 9 * * *',
        enabled,
        lastRunAt: null,
        nextRunAt: Date.now(),
        createdAt: Date.now(),
      }),
    updateLastRun: () => Effect.succeed(undefined),
    updateNextRun: () => Effect.succeed(undefined),
  })
);

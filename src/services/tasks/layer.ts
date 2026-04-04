import { and, eq, isNull } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { tasks } from '../../infrastructure/db/schema';
import type { Task } from '../../infrastructure/db/schema';
import { DatabaseError } from '../../shared/errors';
import { DatabaseService } from '../database/tag';
import { type TaskInput, type TaskStatus, type TaskUpdateInput, TasksService } from './tag';

export const TasksServiceLive = Layer.effect(
  TasksService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    return TasksService.of({
      getTasks: (userId: number) =>
        Effect.tryPromise({
          try: async () => {
            return await db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(tasks.createdAt);
          },
          catch: (error) => new DatabaseError(error),
        }),

      getTask: (userId: number, taskId: string) =>
        Effect.tryPromise({
          try: async () => {
            const [task] = await db
              .select()
              .from(tasks)
              .where(and(eq(tasks.userId, userId), eq(tasks.taskId, taskId)))
              .limit(1);
            return task || null;
          },
          catch: (error) => new DatabaseError(error),
        }),

      getChildTasks: (userId: number, parentTaskId: string) =>
        Effect.tryPromise({
          try: async () => {
            return await db
              .select()
              .from(tasks)
              .where(and(eq(tasks.userId, userId), eq(tasks.parentTaskId, parentTaskId)))
              .orderBy(tasks.createdAt);
          },
          catch: (error) => new DatabaseError(error),
        }),

      createTask: (userId: number, taskId: string, input: TaskInput) =>
        Effect.gen(function* () {
          const [task] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .insert(tasks)
                .values({
                  userId,
                  taskId,
                  prompt: input.prompt,
                  capabilities: input.capabilities || [],
                  mode: input.mode || 'browser',
                  source: input.source,
                  parentTaskId: input.parentTaskId,
                  maxSteps: input.maxSteps,
                  status: 'pending',
                })
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return task;
        }),

      updateTask: (userId: number, taskId: string, input: TaskUpdateInput) =>
        Effect.gen(function* () {
          const values: Partial<typeof tasks.$inferInsert> = {
            updatedAt: new Date(),
          };

          if (input.status !== undefined) values.status = input.status;
          if (input.result !== undefined) values.result = input.result;
          if (input.summary !== undefined) values.summary = input.summary;
          if (input.error !== undefined) values.error = input.error;
          if (input.steps !== undefined) values.steps = input.steps;

          const [task] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .update(tasks)
                .set(values)
                .where(and(eq(tasks.userId, userId), eq(tasks.taskId, taskId)))
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return task;
        }),

      deleteTask: (userId: number, taskId: string) =>
        Effect.tryPromise({
          try: async () => {
            await db.delete(tasks).where(and(eq(tasks.userId, userId), eq(tasks.taskId, taskId)));
          },
          catch: (error) => new DatabaseError(error),
        }),

      deleteAllTasks: (userId: number) =>
        Effect.tryPromise({
          try: async () => {
            await db.delete(tasks).where(eq(tasks.userId, userId));
          },
          catch: (error) => new DatabaseError(error),
        }),

      updateStatus: (userId: number, taskId: string, status: TaskStatus) =>
        Effect.gen(function* () {
          const values: Partial<typeof tasks.$inferInsert> = {
            status,
            updatedAt: new Date(),
          };

          if (status === 'running') {
            values.startedAt = new Date();
          } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            values.completedAt = new Date();
          }

          const [task] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .update(tasks)
                .set(values)
                .where(and(eq(tasks.userId, userId), eq(tasks.taskId, taskId)))
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return task;
        }),

      startTask: (userId: number, taskId: string) =>
        Effect.gen(function* () {
          const [task] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .update(tasks)
                .set({
                  status: 'running',
                  startedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(and(eq(tasks.userId, userId), eq(tasks.taskId, taskId)))
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return task;
        }),

      completeTask: (userId: number, taskId: string, result: unknown, summary?: string) =>
        Effect.gen(function* () {
          const [task] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .update(tasks)
                .set({
                  status: 'completed',
                  result,
                  summary,
                  completedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(and(eq(tasks.userId, userId), eq(tasks.taskId, taskId)))
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return task;
        }),

      failTask: (userId: number, taskId: string, error: string) =>
        Effect.gen(function* () {
          const [task] = yield* Effect.tryPromise({
            try: async () => {
              return await db
                .update(tasks)
                .set({
                  status: 'failed',
                  error,
                  completedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(and(eq(tasks.userId, userId), eq(tasks.taskId, taskId)))
                .returning();
            },
            catch: (error) => new DatabaseError(error),
          });

          return task;
        }),
    });
  })
);

// Layer para testing
export const TasksServiceTest = Layer.succeed(
  TasksService,
  TasksService.of({
    getTasks: () => Effect.succeed([]),
    getTask: () => Effect.succeed(null),
    getChildTasks: () => Effect.succeed([]),
    createTask: (userId, taskId, input) =>
      Effect.succeed({
        id: 1,
        userId,
        taskId,
        prompt: input.prompt,
        status: 'pending',
        capabilities: input.capabilities || [],
        mode: input.mode || 'browser',
        source: input.source || null,
        parentTaskId: input.parentTaskId || null,
        result: null,
        summary: null,
        error: null,
        steps: 0,
        maxSteps: input.maxSteps || null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    updateTask: (userId, taskId, input) =>
      Effect.succeed({
        id: 1,
        userId,
        taskId,
        prompt: '',
        status: input.status || 'pending',
        capabilities: [],
        mode: 'browser',
        source: null,
        parentTaskId: null,
        result: input.result || null,
        summary: input.summary || null,
        error: input.error || null,
        steps: input.steps || 0,
        maxSteps: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    deleteTask: () => Effect.succeed(undefined),
    deleteAllTasks: () => Effect.succeed(undefined),
    updateStatus: (userId, taskId, status) =>
      Effect.succeed({
        id: 1,
        userId,
        taskId,
        prompt: '',
        status,
        capabilities: [],
        mode: 'browser',
        source: null,
        parentTaskId: null,
        result: null,
        summary: null,
        error: null,
        steps: 0,
        maxSteps: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    startTask: (userId, taskId) =>
      Effect.succeed({
        id: 1,
        userId,
        taskId,
        prompt: '',
        status: 'running',
        capabilities: [],
        mode: 'browser',
        source: null,
        parentTaskId: null,
        result: null,
        summary: null,
        error: null,
        steps: 0,
        maxSteps: null,
        startedAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    completeTask: (userId, taskId, result, summary) =>
      Effect.succeed({
        id: 1,
        userId,
        taskId,
        prompt: '',
        status: 'completed',
        capabilities: [],
        mode: 'browser',
        source: null,
        parentTaskId: null,
        result,
        summary: summary || null,
        error: null,
        steps: 0,
        maxSteps: null,
        startedAt: null,
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    failTask: (userId, taskId, error) =>
      Effect.succeed({
        id: 1,
        userId,
        taskId,
        prompt: '',
        status: 'failed',
        capabilities: [],
        mode: 'browser',
        source: null,
        parentTaskId: null,
        result: null,
        summary: null,
        error,
        steps: 0,
        maxSteps: null,
        startedAt: null,
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
  })
);

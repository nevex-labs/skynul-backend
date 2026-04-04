import { and, eq, sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { type ProjectWithTasks, projectTasks, projects } from '../../infrastructure/db/schema';
import { DatabaseError, ProjectNotFoundError } from '../../shared/errors';
import { DatabaseService } from '../database';
import { ProjectService } from './tag';

export const ProjectServiceLive = Layer.effect(
  ProjectService,
  Effect.gen(function* () {
    const db = yield* DatabaseService;

    return ProjectService.of({
      list: (userId: number) =>
        Effect.tryPromise({
          try: async () => {
            const allProjects = await db
              .select()
              .from(projects)
              .where(eq(projects.userId, userId))
              .orderBy(sql`${projects.createdAt} DESC`);
            const projectList: ProjectWithTasks[] = [];

            for (const project of allProjects) {
              const tasks = await db
                .select({ taskId: projectTasks.taskId })
                .from(projectTasks)
                .where(eq(projectTasks.projectId, project.id))
                .orderBy(projectTasks.addedAt);

              projectList.push({
                ...project,
                taskIds: tasks.map((t) => t.taskId),
              });
            }

            return projectList;
          },
          catch: (error) => new DatabaseError(error),
        }),

      create: (userId: number, name: string, color = '#6366f1') =>
        Effect.tryPromise({
          try: async () => {
            const [project] = await db.insert(projects).values({ userId, name, color }).returning();
            return project;
          },
          catch: (error) => new DatabaseError(error),
        }),

      update: (userId: number, id: number, name: string, color: string) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [updated] = await db
                .update(projects)
                .set({ name, color, updatedAt: new Date() })
                .where(and(eq(projects.id, id), eq(projects.userId, userId)))
                .returning();
              return updated;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result) {
            return yield* Effect.fail(new ProjectNotFoundError(id));
          }
        }),

      delete: (userId: number, id: number) =>
        Effect.tryPromise({
          try: async () => {
            await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
          },
          catch: (error) => new DatabaseError(error),
        }),

      addTask: (userId: number, projectId: number, taskId: string) =>
        Effect.gen(function* () {
          const p = yield* Effect.tryPromise({
            try: async () => {
              const r = await db
                .select({ id: projects.id })
                .from(projects)
                .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
                .limit(1);
              return r[0];
            },
            catch: (error) => new DatabaseError(error),
          });
          if (!p) {
            return yield* Effect.fail(new ProjectNotFoundError(projectId));
          }
          yield* Effect.tryPromise({
            try: async () => {
              await db.insert(projectTasks).values({ projectId, taskId }).onConflictDoNothing();
            },
            catch: (error) => new DatabaseError(error),
          });
        }),

      removeTask: (userId: number, projectId: number, taskId: string) =>
        Effect.gen(function* () {
          const p = yield* Effect.tryPromise({
            try: async () => {
              const r = await db
                .select({ id: projects.id })
                .from(projects)
                .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
                .limit(1);
              return r[0];
            },
            catch: (error) => new DatabaseError(error),
          });
          if (!p) {
            return yield* Effect.fail(new ProjectNotFoundError(projectId));
          }
          yield* Effect.tryPromise({
            try: async () => {
              await db
                .delete(projectTasks)
                .where(sql`${projectTasks.projectId} = ${projectId} AND ${projectTasks.taskId} = ${taskId}`);
            },
            catch: (error) => new DatabaseError(error),
          });
        }),
    });
  })
);

export const ProjectServiceTest = Layer.succeed(
  ProjectService,
  ProjectService.of({
    list: () => Effect.succeed([]),
    create: (userId, name, color) =>
      Effect.succeed({
        id: 1,
        userId,
        name,
        color: color ?? '#6366f1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    update: () => Effect.succeed(undefined),
    delete: () => Effect.succeed(undefined),
    addTask: () => Effect.succeed(undefined),
    removeTask: () => Effect.succeed(undefined),
  })
);

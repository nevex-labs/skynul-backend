import { eq, sql } from 'drizzle-orm';
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
      list: () =>
        Effect.tryPromise({
          try: async () => {
            const allProjects = await db.select().from(projects).orderBy(sql`${projects.createdAt} DESC`);
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

      create: (name, color = '#6366f1') =>
        Effect.tryPromise({
          try: async () => {
            const [project] = await db.insert(projects).values({ name, color }).returning();
            return project;
          },
          catch: (error) => new DatabaseError(error),
        }),

      update: (id, name, color) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const [updated] = await db
                .update(projects)
                .set({ name, color, updatedAt: new Date() })
                .where(eq(projects.id, id))
                .returning();
              return updated;
            },
            catch: (error) => new DatabaseError(error),
          });

          if (!result) {
            return yield* Effect.fail(new ProjectNotFoundError(id));
          }
        }),

      delete: (id) =>
        Effect.tryPromise({
          try: async () => {
            await db.delete(projects).where(eq(projects.id, id));
          },
          catch: (error) => new DatabaseError(error),
        }),

      addTask: (projectId, taskId) =>
        Effect.tryPromise({
          try: async () => {
            await db.insert(projectTasks).values({ projectId, taskId }).onConflictDoNothing();
          },
          catch: (error) => new DatabaseError(error),
        }),

      removeTask: (projectId, taskId) =>
        Effect.tryPromise({
          try: async () => {
            await db
              .delete(projectTasks)
              .where(sql`${projectTasks.projectId} = ${projectId} AND ${projectTasks.taskId} = ${taskId}`);
          },
          catch: (error) => new DatabaseError(error),
        }),
    });
  })
);

// Layer para testing
export const ProjectServiceTest = Layer.succeed(
  ProjectService,
  ProjectService.of({
    list: () => Effect.succeed([]),
    create: (name, color) =>
      Effect.succeed({ id: 1, name, color: color ?? '#6366f1', createdAt: new Date(), updatedAt: new Date() }),
    update: () => Effect.succeed(undefined),
    delete: () => Effect.succeed(undefined),
    addTask: () => Effect.succeed(undefined),
    removeTask: () => Effect.succeed(undefined),
  })
);

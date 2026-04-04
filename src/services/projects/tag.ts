import { Context, Effect } from 'effect';
import type { Project, ProjectWithTasks } from '../../infrastructure/db/schema';
import { DatabaseError, ProjectNotFoundError } from '../../shared/errors';

export interface ProjectServiceApi {
  readonly list: () => Effect.Effect<ProjectWithTasks[], DatabaseError>;
  readonly create: (name: string, color?: string) => Effect.Effect<Project, DatabaseError>;
  readonly update: (
    id: number,
    name: string,
    color: string
  ) => Effect.Effect<void, DatabaseError | ProjectNotFoundError>;
  readonly delete: (id: number) => Effect.Effect<void, DatabaseError>;
  readonly addTask: (projectId: number, taskId: string) => Effect.Effect<void, DatabaseError>;
  readonly removeTask: (projectId: number, taskId: string) => Effect.Effect<void, DatabaseError>;
}

export class ProjectService extends Context.Tag('ProjectService')<ProjectService, ProjectServiceApi>() {}

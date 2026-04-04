import { Context, Effect } from 'effect';
import type { Project, ProjectWithTasks } from '../../infrastructure/db/schema';
import { DatabaseError, ProjectNotFoundError } from '../../shared/errors';

export interface ProjectServiceApi {
  readonly list: (userId: number) => Effect.Effect<ProjectWithTasks[], DatabaseError>;
  readonly create: (userId: number, name: string, color?: string) => Effect.Effect<Project, DatabaseError>;
  readonly update: (
    userId: number,
    id: number,
    name: string,
    color: string
  ) => Effect.Effect<void, DatabaseError | ProjectNotFoundError>;
  readonly delete: (userId: number, id: number) => Effect.Effect<void, DatabaseError>;
  readonly addTask: (
    userId: number,
    projectId: number,
    taskId: string
  ) => Effect.Effect<void, DatabaseError | ProjectNotFoundError>;
  readonly removeTask: (
    userId: number,
    projectId: number,
    taskId: string
  ) => Effect.Effect<void, DatabaseError | ProjectNotFoundError>;
}

export class ProjectService extends Context.Tag('ProjectService')<ProjectService, ProjectServiceApi>() {}

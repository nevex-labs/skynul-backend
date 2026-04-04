import { Context, Effect } from 'effect';
import type { Task } from '../../infrastructure/db/schema';
import { DatabaseError } from '../../shared/errors';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskInput {
  prompt: string;
  capabilities?: string[];
  mode?: 'browser' | 'code';
  source?: string;
  parentTaskId?: string;
  maxSteps?: number;
}

export interface TaskUpdateInput {
  status?: TaskStatus;
  result?: unknown;
  summary?: string;
  error?: string;
  steps?: number;
}

export interface TasksServiceApi {
  /**
   * Get all tasks for a user
   */
  readonly getTasks: (userId: number) => Effect.Effect<Task[], DatabaseError>;

  /**
   * Get a single task by ID
   */
  readonly getTask: (userId: number, taskId: string) => Effect.Effect<Task | null, DatabaseError>;

  /**
   * Get tasks by parent ID
   */
  readonly getChildTasks: (userId: number, parentTaskId: string) => Effect.Effect<Task[], DatabaseError>;

  /**
   * Create a new task
   */
  readonly createTask: (userId: number, taskId: string, input: TaskInput) => Effect.Effect<Task, DatabaseError>;

  /**
   * Update an existing task
   */
  readonly updateTask: (userId: number, taskId: string, input: TaskUpdateInput) => Effect.Effect<Task, DatabaseError>;

  /**
   * Delete a task
   */
  readonly deleteTask: (userId: number, taskId: string) => Effect.Effect<void, DatabaseError>;

  /**
   * Delete all tasks for a user
   */
  readonly deleteAllTasks: (userId: number) => Effect.Effect<void, DatabaseError>;

  /**
   * Update task status
   */
  readonly updateStatus: (userId: number, taskId: string, status: TaskStatus) => Effect.Effect<Task, DatabaseError>;

  /**
   * Mark task as started
   */
  readonly startTask: (userId: number, taskId: string) => Effect.Effect<Task, DatabaseError>;

  /**
   * Mark task as completed with result
   */
  readonly completeTask: (
    userId: number,
    taskId: string,
    result: unknown,
    summary?: string
  ) => Effect.Effect<Task, DatabaseError>;

  /**
   * Mark task as failed with error
   */
  readonly failTask: (userId: number, taskId: string, error: string) => Effect.Effect<Task, DatabaseError>;
}

export class TasksService extends Context.Tag('TasksService')<TasksService, TasksServiceApi>() {}

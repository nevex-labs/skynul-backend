/**
 * Adapter para reemplazar data/tasks.json con TasksService (Effect + PostgreSQL)
 *
 * Expone funciones async/await compatibles con TaskManager,
 * pero usa Effect internamente con TasksService.
 */
import { Effect } from 'effect';
import { AppLayer } from '../../config/layers';
import { type TaskInput, type TaskUpdateInput, TasksService } from '../../services/tasks';
import type { Task } from '../../types';

// System user ID para tasks sin owner (TaskManager legacy)
const SYSTEM_USER_ID = 1;

function userId(task: Task): number {
  return task.userId ?? SYSTEM_USER_ID;
}

/**
 * Load all tasks from database (system user only — TaskManager legacy)
 */
export async function loadTasks(): Promise<Task[]> {
  const program = Effect.gen(function* () {
    const service = yield* TasksService;
    return yield* service.getTasks(SYSTEM_USER_ID);
  });

  const result = await Effect.runPromiseExit(program.pipe(Effect.provide(AppLayer)));

  if (result._tag === 'Success') {
    return result.value.map(dbTaskToTask);
  }

  return [];
}

/**
 * Save a task to database
 */
export async function saveTask(task: Task): Promise<void> {
  const uid = userId(task);
  const program = Effect.gen(function* () {
    const service = yield* TasksService;
    const existing = yield* service.getTask(uid, task.id);

    if (existing) {
      const update: TaskUpdateInput = {
        status: task.status as any,
        result: (task as any).result,
        summary: task.summary,
        error: task.error,
        steps: task.steps?.length,
      };
      yield* service.updateTask(uid, task.id, update);
    } else {
      const input: TaskInput = {
        prompt: task.prompt,
        capabilities: task.capabilities as string[],
        mode: task.mode,
        source: task.source,
        parentTaskId: task.parentTaskId,
        maxSteps: task.maxSteps,
      };
      yield* service.createTask(uid, task.id, input);
    }
  });

  const result = await Effect.runPromiseExit(program.pipe(Effect.provide(AppLayer)));

  if (result._tag === 'Failure') {
    console.error('[tasks-adapter] saveTask error:', result.cause);
  }
}

/**
 * Save multiple tasks to database
 */
export async function saveTasks(tasks: Task[]): Promise<void> {
  await Promise.all(tasks.map(saveTask));
}

/**
 * Delete a task from database
 */
export async function deleteTask(taskId: string, uid?: number): Promise<void> {
  const userId = uid ?? SYSTEM_USER_ID;
  const program = Effect.gen(function* () {
    const service = yield* TasksService;
    yield* service.deleteTask(userId, taskId);
  });

  const result = await Effect.runPromiseExit(program.pipe(Effect.provide(AppLayer)));

  if (result._tag === 'Failure') {
    console.error('[tasks-adapter] deleteTask error:', result.cause);
  }
}

// Convert DB task to legacy Task type
function dbTaskToTask(dbTask: any): Task {
  return {
    id: dbTask.taskId,
    userId: dbTask.userId,
    prompt: dbTask.prompt,
    status: dbTask.status as Task['status'],
    capabilities: (dbTask.capabilities || []) as Task['capabilities'],
    mode: dbTask.mode as Task['mode'],
    source: dbTask.source as Task['source'],
    parentTaskId: dbTask.parentTaskId,
    summary: dbTask.summary,
    error: dbTask.error,
    maxSteps: dbTask.maxSteps,
    createdAt: dbTask.createdAt ? new Date(dbTask.createdAt).getTime() : Date.now(),
    updatedAt: dbTask.updatedAt ? new Date(dbTask.updatedAt).getTime() : Date.now(),
    steps: [],
    runner: dbTask.runner,
    agentName: (dbTask as any).agentName,
    agentRole: (dbTask as any).agentRole,
    agent: (dbTask as any).agent,
    attachments: (dbTask as any).attachments,
    model: (dbTask as any).model,
    skipMemory: (dbTask as any).skipMemory,
    timeoutMs: (dbTask as any).timeoutMs,
  } as Task;
}

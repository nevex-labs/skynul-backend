import { eq, isNull } from 'drizzle-orm';
import { db } from '../index';
import type { NewTask, TaskStatus } from '../schema/tasks';
import { tasksTable } from '../schema/tasks';

export async function createTask(input: NewTask) {
  const [task] = await db.insert(tasksTable).values(input).returning();
  return task;
}

export async function getTaskById(id: string) {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  return task;
}

export async function getTasksByUser(userId: string) {
  return db.select().from(tasksTable).where(eq(tasksTable.userId, userId));
}

export async function getTasksByParent(parentTaskId: string | null) {
  if (parentTaskId === null) {
    return db.select().from(tasksTable).where(isNull(tasksTable.parentTaskId));
  }
  return db.select().from(tasksTable).where(eq(tasksTable.parentTaskId, parentTaskId));
}

export async function updateTaskStatus(id: string, status: TaskStatus) {
  const [task] = await db.update(tasksTable).set({ status }).where(eq(tasksTable.id, id)).returning();
  return task;
}

export async function updateTask(
  id: string,
  data: Partial<{
    status: TaskStatus;
    summary: string | null;
    error: string | null;
    usageInputTokens: number | null;
    usageOutputTokens: number | null;
  }>
) {
  const [task] = await db.update(tasksTable).set(data).where(eq(tasksTable.id, id)).returning();
  return task;
}

export async function deleteTask(id: string) {
  await db.delete(tasksTable).where(eq(tasksTable.id, id));
}

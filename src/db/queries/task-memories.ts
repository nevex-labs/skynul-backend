import { desc, eq, ilike } from 'drizzle-orm';
import { db } from '../index';
import type { NewTaskMemory, TaskMemory } from '../schema/task-memories';
import { taskMemoriesTable } from '../schema/task-memories';

export async function saveMemory(input: NewTaskMemory) {
  const existing = await db
    .select()
    .from(taskMemoriesTable)
    .where(eq(taskMemoriesTable.taskId, input.taskId))
    .then((rows) => rows[0]);

  if (existing) {
    await db.update(taskMemoriesTable).set(input).where(eq(taskMemoriesTable.id, existing.id));
    return existing.id;
  }
  const [row] = await db.insert(taskMemoriesTable).values(input).returning();
  return row.id;
}

export async function searchMemories(query: string, limit = 3): Promise<TaskMemory[]> {
  const words = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (words.length === 0) return [];

  const pattern = `%${words.join('%')}%`;
  return db
    .select()
    .from(taskMemoriesTable)
    .where(ilike(taskMemoriesTable.prompt, pattern))
    .orderBy(desc(taskMemoriesTable.createdAt))
    .limit(limit) as Promise<TaskMemory[]>;
}

export async function getMemoriesByUser(userId: string): Promise<TaskMemory[]> {
  return db
    .select()
    .from(taskMemoriesTable)
    .where(eq(taskMemoriesTable.userId, userId))
    .orderBy(desc(taskMemoriesTable.createdAt)) as Promise<TaskMemory[]>;
}

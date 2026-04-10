import type { Task } from '../../../types';

type TaskManagerLike = {
  spawnTask(prompt: string, parentTaskId: string, opts?: any): Promise<{ taskId: string }>;
  get(taskId: string): Task | undefined;
  waitForTasks(taskIds: string[], timeoutMs: number): Promise<any[]>;
  list(): Task[];
  sendMessage(taskId: string, fromTaskId: string, message: string): void;
  cancel(taskId: string, reason?: string): Task;
};

export type ExecutorContext = {
  task: Task;
  taskManager: TaskManagerLike | null;
  appBridge: { run: (app: string, script: string) => Promise<{ ok: boolean; output: string; error?: string }> };
  pushUpdate: () => void;
  pushStatus: (msg: string) => void;
  paperMode?: boolean;
};

export type ExecutorResult = { ok: true; value: string } | { ok: false; error: string };

export function errResult(error: string): ExecutorResult {
  return { ok: false, error };
}

export function result(value: string): ExecutorResult {
  return { ok: true, value };
}

export function headTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.6);
  const tail = limit - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n\n[... ${omitted} chars omitted ...]\n\n${text.slice(text.length - tail)}`;
}

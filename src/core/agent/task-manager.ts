/**
 * TaskManager — facade que une TaskStore (persistencia) +
 * TaskOrchestrator (ejecución). API compatible con el código existente.
 */

import type { Task, TaskCapabilityId, TaskCreateRequest, TaskMode } from '../../types';
import { type OrchestratorSelf, TaskOrchestrator } from './task-orchestrator';
import { TaskStore } from './task-store';

export { TaskOrchestrator, TaskStore };

// ── Facade ──────────────────────────────────────────────────────

export class TaskManager {
  private store: TaskStore;
  private orchestrator: TaskOrchestrator;

  constructor() {
    this.store = new TaskStore();
    // Self-reference: el orchestrator recibe `this` para acceder a los
    // métodos de orquestación (spawnAndWait, waitForTasks, cancel).
    // Se usa un wrapper que cumple OrchestratorSelf para evitar circularidad.
    const self: OrchestratorSelf = {
      spawnAndWait: (...args) => this.orchestrator.spawnAndWait(...args),
      spawnTask: (...args) => this.orchestrator.spawnTask(...args),
      waitForTasks: (...args) => this.orchestrator.waitForTasks(...args),
      cancel: (...args) => this.orchestrator.cancel(...args),
      on: (event, listener) => this.store.on(event as any, listener),
      removeListener: (event, listener) => this.store.removeListener(event as any, listener),
    };
    this.orchestrator = new TaskOrchestrator(this.store, self);
  }

  // ── Store delegation (CRUD + messaging) ───────────────────────

  create(req: TaskCreateRequest): Task {
    return this.store.create(req);
  }
  get(taskId: string): Task | undefined {
    return this.store.get(taskId);
  }
  list(): Task[] {
    return this.store.list();
  }
  delete(taskId: string): void {
    this.orchestrator.delete(taskId);
  }
  sendMessage(targetTaskId: string, fromTaskId: string, message: string): void {
    this.store.sendMessage(targetTaskId, fromTaskId, message);
  }
  drainMessages(taskId: string): Array<{ from: string; message: string }> {
    return this.store.drainMessages(taskId);
  }

  // ── EventEmitter compat ───────────────────────────────────────

  on(event: string, listener: (...args: unknown[]) => void): this {
    this.store.on(event as any, listener);
    return this;
  }
  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    this.store.removeListener(event as any, listener);
    return this;
  }
  emit(event: string, task: Task): boolean {
    return this.store.emit(event as any, task);
  }

  // ── Orchestrator delegation (execution) ──────────────────────

  async approve(taskId: string): Promise<Task> {
    return this.orchestrator.approve(taskId);
  }
  async spawnAndWait(
    prompt: string,
    parentCapabilities: TaskCapabilityId[],
    parentTaskId?: string,
    agentIdentity?: { agentName?: string; agentRole?: string }
  ): Promise<{ taskId: string; status: Task['status']; output: string; summary?: string; error?: string }> {
    return this.orchestrator.spawnAndWait(prompt, parentCapabilities, parentTaskId, agentIdentity);
  }
  async spawnTask(
    prompt: string,
    parentTaskId: string,
    opts?: {
      mode?: TaskMode;
      capabilities?: TaskCapabilityId[];
      agentName?: string;
      agentRole?: string;
      maxSteps?: number;
      model?: string;
    }
  ): Promise<{ taskId: string }> {
    return this.orchestrator.spawnTask(prompt, parentTaskId, opts);
  }
  async waitForTasks(
    taskIds: string[],
    timeoutMs: number
  ): Promise<Array<{ taskId: string; status: Task['status']; summary?: string; error?: string }>> {
    return this.orchestrator.waitForTasks(taskIds, timeoutMs);
  }
  cancel(taskId: string, reason?: string): Task {
    return this.orchestrator.cancel(taskId, reason);
  }
  async destroyAll(): Promise<void> {
    await this.orchestrator.destroyAll();
  }
}

export const taskManager = new TaskManager();

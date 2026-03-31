import { stat } from 'fs/promises';
import type { ChannelId, ChannelSettings, Task, TaskSource } from '../../types';
import { inferTaskSetupRules } from '../agent/task-inference';
import type { TaskManager } from '../agent/task-manager';
import type { ChannelManager } from './channel-manager';
import { formatTaskComplete, formatTaskFailed, formatTaskSummary } from './message-formatter';

/** Extract file paths from task summary (Windows & WSL paths). */
function extractFilePaths(text: string): string[] {
  const paths: string[] = [];
  // Windows paths: C:\...\file.ext or /mnt/c/.../file.ext
  const re = /(?:[A-Z]:\\[\w\\. -]+\.\w{2,5}|\/mnt\/[a-z]\/[\w/. -]+\.\w{2,5})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) paths.push(m[0]);
  return paths;
}

export abstract class Channel {
  abstract readonly id: ChannelId;
  protected taskManager: TaskManager;
  protected channelManager: ChannelManager | null = null;

  constructor(taskManager: TaskManager) {
    this.taskManager = taskManager;
  }

  /** Called by ChannelManager after construction to inject back-reference. */
  setChannelManager(cm: ChannelManager): void {
    this.channelManager = cm;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract getSettings(): ChannelSettings;
  abstract setEnabled(enabled: boolean): Promise<ChannelSettings>;
  abstract setCredentials(creds: Record<string, string>): Promise<void>;
  abstract generatePairingCode(): Promise<string>;
  abstract unpair(): Promise<void>;

  /** Send a text message to the paired user/chat. Subclasses implement this. */
  protected abstract sendMessage(text: string): Promise<void>;

  /** Send a file to the paired user/chat. Override in subclasses that support it. */
  protected async sendFile(_filePath: string): Promise<void> {
    // Default: no-op. Subclasses override.
  }

  /** Subscribe to task updates and relay them to the channel. */
  protected subscribeToTaskUpdates(): void {
    this.taskManager.on('taskUpdate', (task: Task) => {
      void this.handleTaskUpdate(task);
    });
  }

  private async handleTaskUpdate(task: Task): Promise<void> {
    console.log(`[${this.id}] taskUpdate: id=${task.id} status=${task.status} source=${task.source}`);

    // Only notify for tasks originated from THIS channel
    if (task.source !== this.id) return;

    try {
      if (task.status === 'completed') {
        console.log(`[${this.id}] Sending completion message for task ${task.id}`);
        await this.sendMessage(formatTaskComplete(task));

        // Auto-attach files found in summary
        if (task.summary) {
          for (const fp of extractFilePaths(task.summary)) {
            try {
              // Convert Windows path to WSL if needed
              const wslPath = fp.match(/^[A-Z]:\\/i)
                ? '/mnt/' + fp[0].toLowerCase() + fp.slice(2).replace(/\\/g, '/')
                : fp;
              const info = await stat(wslPath);
              if (info.isFile() && info.size <= 50 * 1024 * 1024) {
                await this.sendFile(wslPath);
              }
            } catch {
              // File doesn't exist or can't be read — skip silently
            }
          }
        }
        return;
      }

      if (task.status === 'monitoring') {
        const m = task.monitor;
        if (m) {
          const interval = Math.round(m.intervalMs / 60000);
          await this.sendMessage(
            `Posición abierta, la estoy monitoreando cada ${interval} min. ` +
              `TP: $${m.takeProfitPrice}, SL: $${m.stopLossPrice}. Te aviso cuando cierre.`
          );
        }
        return;
      }

      if (task.status === 'failed' || task.status === 'cancelled') {
        console.log(`[${this.id}] Sending failure message for task ${task.id}`);
        await this.sendMessage(formatTaskFailed(task));
        return;
      }

      // No step-by-step updates — only final results
    } catch (e) {
      console.warn(`[${this.id}] Failed to send update:`, e);
    }
  }

  /** Helper: create a task from an incoming message. Auto-approves if global setting is ON. */
  protected async createTaskFromMessage(prompt: string): Promise<Task> {
    const inferred = inferTaskSetupRules({ prompt });

    const task = this.taskManager.create({
      prompt,
      capabilities: inferred.capabilities,
      mode: inferred.mode,
      source: this.id as TaskSource,
    });

    const autoApprove = this.channelManager?.isAutoApprove() ?? true;
    if (autoApprove) {
      // Only send ack for tasks that will take time (have capabilities = real work)
      if (inferred.capabilities.length > 0) {
        await this.sendMessage('Dale, ya lo estoy haciendo.');
      }
      await this.taskManager.approve(task.id);
    } else {
      await this.sendMessage('Tarea creada, aprobala desde la app.');
    }
    return task;
  }

  /** Helper: format a task summary (reused by subclasses). */
  protected formatSummary(task: Task): string {
    return formatTaskSummary(task);
  }
}

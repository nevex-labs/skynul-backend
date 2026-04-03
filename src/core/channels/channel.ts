import { stat } from 'fs/promises';
import type { ChannelId, ChannelSettings, Task, TaskSource } from '../../types';
import { inferTaskSetup } from '../agent/task-inference';
import { dispatchChat } from '../providers/dispatch';
import { policyState } from '../../routes/agent/policy';
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
  private lastTaskId: string | null = null;

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

  /**
   * Check if the last task from this channel finished asking for info (no real execution).
   * If so, the next message is likely a reply → resume instead of creating a new task.
   */
  private getResumableTask(): Task | null {
    if (!this.lastTaskId) return null;
    const task = this.taskManager.get(this.lastTaskId);
    if (!task) return null;

    const terminal = task.status === 'completed' || task.status === 'failed';
    if (!terminal) return null;

    // Check if the task ended without executing any real action (just asked for info)
    const realActionTypes = new Set([
      'chain_swap', 'chain_send_token', 'chain_deploy_token',
      'cex_place_order', 'cex_cancel_order', 'cex_withdraw',
      'polymarket_place_order', 'polymarket_close_position',
      'navigate', 'click', 'type', 'shell',
    ]);
    const didRealWork = task.steps.some((s) => realActionTypes.has(s.action?.type));
    if (didRealWork) return null;

    return task;
  }

  /** Helper: create a task from an incoming message, or resume the last one if it was waiting for info. */
  protected async createTaskFromMessage(prompt: string): Promise<Task> {
    // If the last task ended asking for data, resume it with this message
    const resumable = this.getResumableTask();
    if (resumable) {
      this.lastTaskId = resumable.id;
      const resumed = await this.taskManager.resume(resumable.id, prompt);
      return resumed;
    }

    const inferred = await inferTaskSetup({
      input: { prompt },
      strategy: 'auto',
      chat: (messages) => dispatchChat(policyState.provider.active, messages),
    });

    const task = this.taskManager.create({
      prompt,
      capabilities: inferred.capabilities,
      mode: inferred.mode,
      source: this.id as TaskSource,
    });

    this.lastTaskId = task.id;

    const autoApprove = this.channelManager?.isAutoApprove() ?? true;
    if (autoApprove) {
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

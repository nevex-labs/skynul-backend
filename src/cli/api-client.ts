import type { ChannelSettings } from '../shared/types/channel.js';
import type { Task, TaskCreateRequest } from '../shared/types/task.js';

const DEFAULT_BASE = 'http://127.0.0.1:3141';

export class SkynulClient {
  private base: string;
  private token: string | undefined;

  constructor(base?: string, token?: string) {
    this.base = (base ?? DEFAULT_BASE).replace(/\/$/, '');
    this.token = token ?? process.env.SKYNUL_API_TOKEN;
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (init?.headers) Object.assign(headers, init.headers);
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetch(`${this.base}${path}`, { ...init, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Health ──────────────────────────────────────────────────────────────

  async ping(): Promise<{ status: string; ts: number; wsClients: number }> {
    return this.fetch('/ping');
  }

  // ── Tasks ───────────────────────────────────────────────────────────────

  async listTasks(): Promise<Task[]> {
    const data = await this.fetch<{ tasks: Task[] }>('/api/tasks');
    return data.tasks;
  }

  async getTask(id: string): Promise<Task> {
    return this.fetch(`/api/tasks/${id}`);
  }

  async cancelTask(id: string): Promise<Task> {
    return this.fetch(`/api/tasks/${id}/cancel`, { method: 'POST' });
  }

  async createTask(req: TaskCreateRequest): Promise<Task> {
    const data = await this.fetch<{ task: Task }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(req),
    });
    return data.task;
  }

  async deleteTask(id: string): Promise<void> {
    await this.fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  }

  async sendMessage(id: string, message: string): Promise<void> {
    await this.fetch(`/api/tasks/${id}/message`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  // ── Channels ────────────────────────────────────────────────────────────

  async listChannels(): Promise<ChannelSettings[]> {
    const data = await this.fetch<{ channels: ChannelSettings[] }>('/api/integrations/channels');
    return data.channels;
  }

  // ── Runtime ─────────────────────────────────────────────────────────────

  async runtimeStats(): Promise<{
    app: { cpuPercent: number; memoryMB: number };
    system: { freeMemMB: number };
  }> {
    return this.fetch('/api/system/runtime/stats');
  }

  // ── Policy ──────────────────────────────────────────────────────────────

  async getPolicy(): Promise<{
    provider: { active: string; openaiModel: string };
    taskAutoApprove: boolean;
    paperTradingEnabled: boolean;
  }> {
    return this.fetch('/api/agent/policy');
  }

  async setProvider(active: string): Promise<void> {
    await this.fetch('/api/agent/policy/provider', {
      method: 'PUT',
      body: JSON.stringify({ active }),
    });
  }

  async setModel(model: string): Promise<void> {
    await this.fetch('/api/agent/policy/provider/model', {
      method: 'PUT',
      body: JSON.stringify({ model }),
    });
  }

  wsUrl(): string {
    return this.base.replace(/^http/, 'ws') + '/ws';
  }
}

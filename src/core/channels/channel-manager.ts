import { join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import type { ChannelGlobalSettings, ChannelId, ChannelSettings } from '../../types';
import type { TaskManager } from '../agent/task-manager';
import { getDataDir } from '../config';
import type { Channel } from './channel';
import { DiscordChannel } from './discord-channel';
import { SignalChannel } from './signal-channel';
import { SlackChannel } from './slack-channel';
import { TelegramChannel } from './telegram-channel';
import { WhatsAppChannel } from './whatsapp-channel';

const DEFAULT_GLOBAL: ChannelGlobalSettings = { autoApprove: true };

export class ChannelManager {
  private channels = new Map<ChannelId, Channel>();
  private global: ChannelGlobalSettings = { ...DEFAULT_GLOBAL };

  private get globalPath(): string {
    return join(getDataDir(), 'channels', 'global.json');
  }

  constructor(taskManager: TaskManager) {
    this.channels.set('telegram', new TelegramChannel(taskManager));
    this.channels.set('whatsapp', new WhatsAppChannel(taskManager));
    this.channels.set('discord', new DiscordChannel(taskManager));
    this.channels.set('signal', new SignalChannel(taskManager));
    this.channels.set('slack', new SlackChannel(taskManager));

    // Inject back-reference so channels can check global settings
    for (const ch of this.channels.values()) {
      ch.setChannelManager(this);
    }
  }

  async loadGlobal(): Promise<void> {
    try {
      const raw = await readFile(this.globalPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ChannelGlobalSettings>;
      this.global = { ...DEFAULT_GLOBAL, ...parsed };
    } catch {
      // file doesn't exist yet — use defaults
    }
  }

  private async saveGlobal(): Promise<void> {
    const dir = join(getDataDir(), 'channels');
    await mkdir(dir, { recursive: true });
    await writeFile(this.globalPath, JSON.stringify(this.global, null, 2), 'utf8');
  }

  isAutoApprove(): boolean {
    return this.global.autoApprove;
  }

  getGlobalSettings(): ChannelGlobalSettings {
    return { ...this.global };
  }

  async setAutoApprove(val: boolean): Promise<ChannelGlobalSettings> {
    this.global.autoApprove = val;
    await this.saveGlobal();
    return this.getGlobalSettings();
  }

  async startAll(): Promise<void> {
    for (const ch of this.channels.values()) {
      try {
        await ch.start();
      } catch (e) {
        console.warn(`[ChannelManager] Failed to start ${ch.id}:`, e);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const ch of this.channels.values()) {
      try {
        await ch.stop();
      } catch (e) {
        console.warn(`[ChannelManager] Failed to stop ${ch.id}:`, e);
      }
    }
  }

  getChannel(id: ChannelId): Channel {
    const ch = this.channels.get(id);
    if (!ch) throw new Error(`Unknown channel: ${id}`);
    return ch;
  }

  getAllSettings(): ChannelSettings[] {
    return Array.from(this.channels.values()).map((ch) => ch.getSettings());
  }
}

import {
  CHANNEL_CONFIG_GLOBAL_KEY,
  readChannelConfigState,
  writeChannelConfigState,
} from '../../services/channel-config-runtime';
import type { ChannelGlobalSettings, ChannelId, ChannelSettings } from '../../types';
import type { TaskManager } from '../agent/task-manager';
import { config } from '../config';
import type { Channel } from './channel';
import { DiscordChannel } from './discord-channel';
import { SignalChannel } from './signal-channel';
import { SlackChannel } from './slack-channel';
import { TelegramChannel } from './telegram-channel';
import { WhatsAppChannel } from './whatsapp-channel';

const DEFAULT_GLOBAL: ChannelGlobalSettings = { autoApprove: true };
const DESKTOP_ONLY_CHANNELS = new Set<ChannelId>(['whatsapp', 'signal']);

export class ChannelManager {
  private channels = new Map<ChannelId, Channel>();
  private global: ChannelGlobalSettings = { ...DEFAULT_GLOBAL };

  constructor(taskManager: TaskManager) {
    this.channels.set('telegram', new TelegramChannel(taskManager));
    this.channels.set('whatsapp', new WhatsAppChannel(taskManager));
    this.channels.set('discord', new DiscordChannel(taskManager));
    this.channels.set('signal', new SignalChannel(taskManager));
    this.channels.set('slack', new SlackChannel(taskManager));

    for (const ch of this.channels.values()) {
      ch.setChannelManager(this);
    }
  }

  async loadGlobal(): Promise<void> {
    try {
      const fromDb = await readChannelConfigState(CHANNEL_CONFIG_GLOBAL_KEY);
      if (fromDb !== null) {
        this.global = { ...DEFAULT_GLOBAL, ...(fromDb as Partial<ChannelGlobalSettings>) };
      }
    } catch {
      this.global = { ...DEFAULT_GLOBAL };
    }
  }

  private async saveGlobal(): Promise<void> {
    await writeChannelConfigState(CHANNEL_CONFIG_GLOBAL_KEY, { ...this.global });
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
      if (config.nodeEnv === 'production' && DESKTOP_ONLY_CHANNELS.has(ch.id)) {
        console.warn(`[ChannelManager] Skipping ${ch.id} in web deployment (desktop-only channel).`);
        continue;
      }
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

import { randomBytes } from 'crypto';
import { dirname, join } from 'path';
import type { Message as DiscordMessage } from 'discord.js';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import type { ChannelId, ChannelSettings } from '../../types';
import type { TaskManager } from '../agent/task-manager';
import { getDataDir } from '../config';
import { getSecret, setSecret } from '../stores/secret-store';
import { Channel } from './channel';
import { handleCommand } from './command-router';

type DiscordState = {
  enabled: boolean;
  paired: boolean;
  pairedUserId: string | null;
  pairedChannelId: string | null;
  pairingCode: string | null;
};

const DEFAULT_STATE: DiscordState = {
  enabled: false,
  paired: false,
  pairedUserId: null,
  pairedChannelId: null,
  pairingCode: null,
};

export class DiscordChannel extends Channel {
  readonly id: ChannelId = 'discord';
  private state: DiscordState = { ...DEFAULT_STATE };
  private client: Client | null = null;
  private lastError: string | null = null;

  constructor(taskManager: TaskManager) {
    super(taskManager);
  }

  async start(): Promise<void> {
    this.state = await this.loadState();
    if (!this.state.enabled) return;

    const token = await getSecret('discord.botToken');
    if (!token) {
      console.warn('[DiscordChannel] Enabled but no bot token set');
      return;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.client.on(Events.ClientReady, () => {
      console.log('[DiscordChannel] Bot ready');
      this.lastError = null;
    });

    this.client.on(Events.MessageCreate, (msg: DiscordMessage) => {
      void this.handleIncoming(msg);
    });

    this.client.on(Events.Error, (err: Error) => {
      this.lastError = err.message;
      console.warn('[DiscordChannel] Error:', err.message);
    });

    this.subscribeToTaskUpdates();

    try {
      await this.client.login(token);
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.warn('[DiscordChannel] Login failed:', this.lastError);
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
  }

  getSettings(): ChannelSettings {
    return {
      id: 'discord',
      enabled: this.state.enabled,
      status: this.client?.isReady() ? 'connected' : this.state.enabled ? 'connecting' : 'disconnected',
      paired: this.state.paired,
      pairingCode: this.state.pairingCode,
      error: this.lastError,
      hasCredentials: false,
      meta: {
        pairedUserId: this.state.pairedUserId,
        pairedChannelId: this.state.pairedChannelId,
      },
    };
  }

  async setEnabled(enabled: boolean): Promise<ChannelSettings> {
    this.state.enabled = enabled;
    await this.saveState();
    if (enabled) {
      await this.start();
    } else {
      await this.stop();
    }
    return this.getSettings();
  }

  async setCredentials(creds: Record<string, string>): Promise<void> {
    if (creds.token) {
      await setSecret('discord.botToken', creds.token.trim());
    }
  }

  async generatePairingCode(): Promise<string> {
    const code = randomBytes(4).toString('hex');
    this.state.pairingCode = code;
    await this.saveState();
    return code;
  }

  async unpair(): Promise<void> {
    this.state.paired = false;
    this.state.pairedUserId = null;
    this.state.pairedChannelId = null;
    this.state.pairingCode = null;
    await this.saveState();
  }

  protected async sendMessage(text: string): Promise<void> {
    if (!this.client || !this.state.pairedChannelId) return;
    const channel = await this.client.channels.fetch(this.state.pairedChannelId);
    if (channel?.isTextBased() && 'send' in channel) {
      await (channel as { send: (msg: string) => Promise<unknown> }).send(text);
    }
  }

  private async handleIncoming(msg: DiscordMessage): Promise<void> {
    if (msg.author.bot) return;
    const content = msg.content?.trim();
    if (!content) return;

    // Pairing: /pair <code>
    if (content.startsWith('/pair ')) {
      const code = content.slice(6).trim();
      if (!this.state.pairingCode) {
        await msg.reply('No hay código de vinculación activo. Generá uno desde los ajustes de Skynul.');
        return;
      }
      if (code !== this.state.pairingCode) {
        await msg.reply('Código inválido.');
        return;
      }
      this.state.paired = true;
      this.state.pairedUserId = msg.author.id;
      this.state.pairedChannelId = msg.channelId;
      this.state.pairingCode = null;
      await this.saveState();
      await msg.reply('\u2705 Vinculado! Mandame un mensaje para crear una tarea.');
      return;
    }

    // Only respond to paired user in paired channel
    if (!this.state.paired || msg.author.id !== this.state.pairedUserId || msg.channelId !== this.state.pairedChannelId)
      return;

    const result = await handleCommand(content, this.taskManager);
    if (result.handled) {
      if (result.text === '__UNPAIR__') {
        await this.unpair();
        await msg.reply('Desvinculado.');
      } else {
        await msg.reply(result.text);
      }
      return;
    }

    // Any other text = create task
    try {
      await this.createTaskFromMessage(content);
    } catch (e) {
      await msg.reply(`No se pudo crear la tarea: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private settingsPath(): string {
    return join(getDataDir(), 'channels', 'discord.json');
  }

  private async loadState(): Promise<DiscordState> {
    try {
      const raw = await readFile(this.settingsPath(), 'utf8');
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private async saveState(): Promise<void> {
    const file = this.settingsPath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(this.state, null, 2), 'utf8');
  }
}

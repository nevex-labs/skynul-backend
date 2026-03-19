import { randomBytes } from 'crypto';
import { dirname, join } from 'path';
import { App as SlackApp } from '@slack/bolt';
import { mkdir, readFile, writeFile } from 'fs/promises';
import type { ChannelId, ChannelSettings } from '../../types';
import type { TaskManager } from '../agent/task-manager';
import { getDataDir } from '../config';
import { getSecret, setSecret } from '../stores/secret-store';
import { Channel } from './channel';
import { handleCommand } from './command-router';

type SlackState = {
  enabled: boolean;
  paired: boolean;
  pairedUserId: string | null;
  pairedChannelId: string | null;
  pairingCode: string | null;
};

const DEFAULT_STATE: SlackState = {
  enabled: false,
  paired: false,
  pairedUserId: null,
  pairedChannelId: null,
  pairingCode: null,
};

export class SlackChannel extends Channel {
  readonly id: ChannelId = 'slack';
  private state: SlackState = { ...DEFAULT_STATE };
  private slackApp: SlackApp | null = null;
  private lastError: string | null = null;
  private ready = false;

  constructor(taskManager: TaskManager) {
    super(taskManager);
  }

  async start(): Promise<void> {
    this.state = await this.loadState();
    if (!this.state.enabled) return;

    const botToken = await getSecret('slack.botToken');
    const appToken = await getSecret('slack.appToken');
    if (!botToken || !appToken) {
      console.warn('[SlackChannel] Enabled but missing tokens');
      return;
    }

    this.slackApp = new SlackApp({
      token: botToken,
      appToken,
      socketMode: true,
    });

    this.slackApp.message(async ({ message, say }) => {
      if (message.subtype) return;
      const msg = message as { user?: string; text?: string; channel?: string };
      if (!msg.user || !msg.text) return;
      await this.handleIncoming(msg.user, msg.text.trim(), msg.channel ?? '', say);
    });

    this.subscribeToTaskUpdates();

    try {
      await this.slackApp.start();
      this.ready = true;
      this.lastError = null;
      console.log('[SlackChannel] Bot ready (socket mode)');
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      console.warn('[SlackChannel] Start failed:', this.lastError);
    }
  }

  async stop(): Promise<void> {
    if (this.slackApp) {
      try {
        await this.slackApp.stop();
      } catch {
        /* ignore */
      }
      this.slackApp = null;
      this.ready = false;
    }
  }

  getSettings(): ChannelSettings {
    return {
      id: 'slack',
      enabled: this.state.enabled,
      status: this.ready ? 'connected' : this.state.enabled ? 'connecting' : 'disconnected',
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
    if (creds.botToken) await setSecret('slack.botToken', creds.botToken.trim());
    if (creds.appToken) await setSecret('slack.appToken', creds.appToken.trim());
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
    if (!this.slackApp || !this.state.pairedChannelId) return;
    try {
      await this.slackApp.client.chat.postMessage({
        channel: this.state.pairedChannelId,
        text,
      });
    } catch (e) {
      console.warn('[SlackChannel] Failed to send:', e);
    }
  }

  private async handleIncoming(
    userId: string,
    content: string,
    channelId: string,
    say: (text: string) => Promise<unknown>
  ): Promise<void> {
    // Pairing
    if (content.startsWith('/pair ')) {
      const code = content.slice(6).trim();
      if (!this.state.pairingCode) {
        await say('No hay código de vinculación activo. Generá uno desde los ajustes de Skynul.');
        return;
      }
      if (code !== this.state.pairingCode) {
        await say('Código inválido.');
        return;
      }
      this.state.paired = true;
      this.state.pairedUserId = userId;
      this.state.pairedChannelId = channelId;
      this.state.pairingCode = null;
      await this.saveState();
      await say('\u2705 Vinculado! Mandame un mensaje para crear una tarea.');
      return;
    }

    // Only respond to paired user
    if (!this.state.paired || userId !== this.state.pairedUserId) return;

    const result = await handleCommand(content, this.taskManager);
    if (result.handled) {
      if (result.text === '__UNPAIR__') {
        await this.unpair();
        await say('Desvinculado.');
      } else {
        await say(result.text);
      }
      return;
    }

    // Any other text = create task
    try {
      const task = await this.createTaskFromMessage(content);
      await say(this.formatSummary(task));
    } catch (e) {
      await say(`No se pudo crear la tarea: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private settingsPath(): string {
    return join(getDataDir(), 'channels', 'slack.json');
  }

  private async loadState(): Promise<SlackState> {
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

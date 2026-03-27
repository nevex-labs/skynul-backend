import { randomBytes } from 'crypto';
import { createWriteStream } from 'fs';
import { basename, dirname, join } from 'path';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { Bot, InputFile } from 'grammy';
import { pipeline } from 'stream/promises';
import type { ChannelId, ChannelSettings } from '../../types';
import type { TaskManager } from '../agent/task-manager';
import { getDataDir } from '../config';
import { getSecret, setSecret } from '../stores/secret-store';
import { Channel } from './channel';
import { handleCommand } from './command-router';

type TelegramState = {
  enabled: boolean;
  pairedChatId: number | null;
  pairingCode: string | null;
};

const DEFAULT_STATE: TelegramState = {
  enabled: false,
  pairedChatId: null,
  pairingCode: null,
};

/** Convert markdown-ish text to Telegram HTML */
function toHtml(text: string): string {
  let out = text
    // Escape HTML entities first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Markdown [text](url) → <a>
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
  // Bare URLs (not already inside href) → clickable <a>
  out = out.replace(/(?<!href=")(https?:\/\/[^\s<]+)/g, '<a href="$1">Link</a>');
  // *bold* → <b>
  out = out.replace(/\*([^*]+)\*/g, '<b>$1</b>');
  // _italic_ → <i>
  out = out.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<i>$1</i>');
  return out;
}

export class TelegramChannel extends Channel {
  readonly id: ChannelId = 'telegram';
  private bot: Bot | null = null;
  private state: TelegramState = { ...DEFAULT_STATE };
  private hasToken = false;
  private statusError: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(taskManager: TaskManager) {
    super(taskManager);
  }

  async start(): Promise<void> {
    this.state = await this.loadState();
    const token = await getSecret('telegram.botToken');
    this.hasToken = !!token;
    if (!this.state.enabled) return;

    if (!token) {
      console.warn('[TelegramChannel] Enabled but no bot token set');
      return;
    }

    // Kill any previous instance before starting a new one
    await this.stop();

    try {
      this.bot = new Bot(token);
      this.statusError = null;

      this.bot.catch((err) => {
        const msg = err.message ?? String(err);
        console.error('[TelegramChannel] Bot error:', msg);
        this.statusError = msg;
      });
      this.registerCommands();
      this.subscribeToTaskUpdates();

      console.log('[TelegramChannel] Starting bot polling...');
      this.bot
        .start({
          onStart: () => {
            console.log('[TelegramChannel] Polling started OK');
            this.statusError = null;
          },
          drop_pending_updates: true,
        })
        .catch((e) => {
          // Polling died — mark as error and schedule retry
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[TelegramChannel] Polling stopped:', msg);
          this.statusError = msg;
          this.bot = null;
          this.scheduleRetry();
        });
    } catch (e) {
      console.error('[TelegramChannel] Failed to start bot:', e);
      this.statusError = e instanceof Error ? e.message : String(e);
      this.bot = null;
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    console.log('[TelegramChannel] Will retry in 30s...');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.state.enabled && !this.bot) {
        void this.start();
      }
    }, 30_000);
  }

  async stop(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
    }
    this.statusError = null;
  }

  getSettings(): ChannelSettings {
    return {
      id: 'telegram',
      enabled: this.state.enabled,
      status: this.bot ? 'connected' : this.state.enabled ? 'error' : 'disconnected',
      paired: this.state.pairedChatId !== null,
      pairingCode: this.state.pairingCode,
      error: this.statusError,
      hasCredentials: this.hasToken,
      meta: { pairedChatId: this.state.pairedChatId },
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
      await setSecret('telegram.botToken', creds.token.trim());
      this.hasToken = true;
    }
  }

  async generatePairingCode(): Promise<string> {
    const code = randomBytes(4).toString('hex');
    this.state.pairingCode = code;
    await this.saveState();
    return code;
  }

  async unpair(): Promise<void> {
    this.state.pairedChatId = null;
    this.state.pairingCode = null;
    await this.saveState();
  }

  protected async sendMessage(text: string): Promise<void> {
    if (!this.state.pairedChatId) {
      console.warn('[TelegramChannel] sendMessage: no pairedChatId, skipping');
      return;
    }
    if (!this.bot) {
      console.warn('[TelegramChannel] sendMessage: bot is null, skipping');
      return;
    }
    try {
      await this.bot.api.sendMessage(this.state.pairedChatId, toHtml(text), { parse_mode: 'HTML' });
    } catch (e) {
      // HTML parse failed — fallback to plain text
      console.warn('[TelegramChannel] HTML send failed, retrying plain:', e);
      await this.bot.api.sendMessage(this.state.pairedChatId, text);
    }
  }

  protected async sendFile(filePath: string): Promise<void> {
    if (!this.state.pairedChatId || !this.bot) return;
    try {
      await this.bot.api.sendDocument(this.state.pairedChatId, new InputFile(filePath, basename(filePath)));
    } catch (e) {
      console.warn('[TelegramChannel] sendFile failed:', e);
    }
  }

  private registerCommands(): void {
    if (!this.bot) return;

    this.bot.command('pair', async (ctx) => {
      const code = ctx.match?.trim();
      if (!code) {
        await ctx.reply('Uso: /pair <código>');
        return;
      }
      if (!this.state.pairingCode) {
        await ctx.reply('No hay código de vinculación activo. Generá uno desde los ajustes de Skynul.');
        return;
      }
      if (code !== this.state.pairingCode) {
        await ctx.reply('Código inválido.');
        return;
      }
      this.state.pairedChatId = ctx.chat.id;
      this.state.pairingCode = null;
      await this.saveState();
      await ctx.reply('\u2705 Vinculado! Mandame un mensaje para crear una tarea.');
    });

    this.bot.command('unpair', async (ctx) => {
      if (!this.isPaired(ctx.chat.id)) return;
      await this.unpair();
      await ctx.reply('Desvinculado. Ya no vas a recibir actualizaciones.');
    });

    this.bot.command('list', async (ctx) => {
      if (!this.isPaired(ctx.chat.id)) return;
      const result = await handleCommand('/list', this.taskManager);
      await ctx.reply(toHtml(result.text), { parse_mode: 'HTML' });
    });

    this.bot.command('status', async (ctx) => {
      if (!this.isPaired(ctx.chat.id)) return;
      const input = ctx.match?.trim();
      if (!input) {
        await ctx.reply('Uso: /status <número> (de /list)');
        return;
      }
      const result = await handleCommand(`/status ${input}`, this.taskManager, {
        resolveTask: (i) => this.resolveTask(i),
      });
      await ctx.reply(toHtml(result.text), { parse_mode: 'HTML' });
    });

    this.bot.command('cancel', async (ctx) => {
      if (!this.isPaired(ctx.chat.id)) return;
      const input = ctx.match?.trim();
      if (!input) {
        await ctx.reply('Uso: /cancel <número> (de /list)');
        return;
      }
      const result = await handleCommand(`/cancel ${input}`, this.taskManager, {
        resolveTask: (i) => this.resolveTask(i),
      });
      if (result.handled && result.text !== '__UNPAIR__') {
        await ctx.reply(toHtml(result.text), { parse_mode: 'HTML' });
      }
    });

    this.bot.command('send', async (ctx) => {
      if (!this.isPaired(ctx.chat.id)) return;
      const filePath = ctx.match?.trim();
      if (!filePath) {
        await ctx.reply('Uso: /send <ruta del archivo>');
        return;
      }
      try {
        const info = await stat(filePath);
        if (!info.isFile()) {
          await ctx.reply('No es un archivo.');
          return;
        }
        if (info.size > 50 * 1024 * 1024) {
          await ctx.reply('El archivo supera 50MB (límite de Telegram).');
          return;
        }
        await ctx.replyWithDocument(new InputFile(filePath, basename(filePath)));
      } catch (e) {
        await ctx.reply(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    this.bot.on('message:document', async (ctx) => {
      if (!this.isPaired(ctx.chat.id)) return;
      try {
        const doc = ctx.message.document;
        const file = await ctx.api.getFile(doc.file_id);
        const url = `https://api.telegram.org/file/bot${this.bot!.token}/${file.file_path}`;
        const destDir = join(getDataDir(), 'received');
        await mkdir(destDir, { recursive: true });
        const destPath = join(destDir, doc.file_name ?? `file_${Date.now()}`);
        const res = await fetch(url);
        if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
        const ws = createWriteStream(destPath);
        await pipeline(res.body, ws);
        await ctx.reply(`\u2705 Guardado en: ${destPath}`);
      } catch (e) {
        await ctx.reply(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    this.bot.on('message:text', async (ctx) => {
      if (!this.isPaired(ctx.chat.id)) {
        await ctx.reply('No estás vinculado. Usá /pair <código> primero.');
        return;
      }
      const prompt = ctx.message.text.trim();
      if (!prompt) return;
      try {
        await this.createTaskFromMessage(prompt);
      } catch (e) {
        await ctx.reply(`No se pudo crear la tarea: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  /** Resolve a task by list number (1-based) or raw ID */
  private resolveTask(input: string): import('../../types').Task | undefined {
    const num = Number.parseInt(input, 10);
    if (!isNaN(num) && num > 0) {
      const tasks = this.taskManager.list();
      return tasks[num - 1];
    }
    return this.taskManager.get(input);
  }

  private isPaired(chatId: number): boolean {
    return this.state.pairedChatId === chatId;
  }

  private settingsPath(): string {
    return join(getDataDir(), 'channels', 'telegram.json');
  }

  private async loadState(): Promise<TelegramState> {
    try {
      const raw = await readFile(this.settingsPath(), 'utf8');
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch {
      // Try migrating from old location
      try {
        const oldPath = join(getDataDir(), 'telegram.json');
        const raw = await readFile(oldPath, 'utf8');
        const migrated = { ...DEFAULT_STATE, ...JSON.parse(raw) };
        await this.saveStateData(migrated);
        return migrated;
      } catch {
        return { ...DEFAULT_STATE };
      }
    }
  }

  private async saveState(): Promise<void> {
    await this.saveStateData(this.state);
  }

  private async saveStateData(data: TelegramState): Promise<void> {
    const file = this.settingsPath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  }
}

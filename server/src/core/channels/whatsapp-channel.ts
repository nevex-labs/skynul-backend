import type { ChannelId, ChannelSettings } from '../../types'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import WAWebJS from 'whatsapp-web.js'
import type { TaskManager } from '../agent/task-manager'
import { getDataDir } from '../config'
import { Channel } from './channel'
import { formatTaskList, formatTaskSummary } from './message-formatter'

const { Client, LocalAuth } = WAWebJS

type WhatsAppState = {
  enabled: boolean
  paired: boolean
  pairedChatId: string | null
  phoneNumber: string | null
}

const DEFAULT_STATE: WhatsAppState = {
  enabled: false,
  paired: false,
  pairedChatId: null,
  phoneNumber: null
}

export class WhatsAppChannel extends Channel {
  readonly id: ChannelId = 'whatsapp'
  private state: WhatsAppState = { ...DEFAULT_STATE }
  private client: InstanceType<typeof Client> | null = null
  private qrCode: string | null = null
  private lastError: string | null = null

  constructor(taskManager: TaskManager) {
    super(taskManager)
  }

  async start(): Promise<void> {
    this.state = await this.loadState()
    if (!this.state.enabled) return

    const sessionPath = join(getDataDir(), 'channels', 'whatsapp-session')
    await mkdir(sessionPath, { recursive: true })

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: sessionPath }),
      puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    })

    this.client.on('qr', (qr: string) => {
      this.qrCode = qr
      console.log('[WhatsAppChannel] QR code received')
    })

    this.client.on('ready', () => {
      console.log('[WhatsAppChannel] Client ready')
      this.qrCode = null
      this.lastError = null
      if (!this.state.paired) {
        this.state.paired = true
        void this.saveState()
      }
    })

    this.client.on('authenticated', () => {
      console.log('[WhatsAppChannel] Authenticated')
    })

    this.client.on('auth_failure', (msg: string) => {
      console.warn('[WhatsAppChannel] Auth failure:', msg)
      this.lastError = msg
    })

    this.client.on('disconnected', (reason: string) => {
      console.warn('[WhatsAppChannel] Disconnected:', reason)
      this.state.paired = false
      this.lastError = reason
      void this.saveState()
    })

    this.client.on('message', (msg: WAWebJS.Message) => {
      void this.handleIncoming(msg)
    })

    this.subscribeToTaskUpdates()

    try {
      await this.client.initialize()
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      console.warn('[WhatsAppChannel] Init failed:', this.lastError)
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      try {
        await this.client.destroy()
      } catch {
        /* ignore */
      }
      this.client = null
    }
    this.qrCode = null
  }

  getSettings(): ChannelSettings {
    const isReady = this.client?.info !== undefined
    return {
      id: 'whatsapp',
      enabled: this.state.enabled,
      status: isReady ? 'connected' : this.state.enabled ? 'connecting' : 'disconnected',
      paired: this.state.paired,
      pairingCode: this.qrCode,
      error: this.lastError,
      hasCredentials: false,
      meta: { pairedChatId: this.state.pairedChatId, phoneNumber: this.state.phoneNumber }
    }
  }

  async setEnabled(enabled: boolean): Promise<ChannelSettings> {
    this.state.enabled = enabled
    await this.saveState()
    if (enabled) {
      await this.start()
    } else {
      await this.stop()
    }
    return this.getSettings()
  }

  async setCredentials(_creds: Record<string, string>): Promise<void> {
    // WhatsApp uses QR-based auth, no manual credentials
  }

  async generatePairingCode(): Promise<string> {
    // QR is generated automatically on client.initialize()
    // Return current QR or a hint
    return this.qrCode ?? 'waiting-for-qr'
  }

  async unpair(): Promise<void> {
    if (this.client) {
      try {
        await this.client.logout()
      } catch {
        /* ignore */
      }
    }
    this.state.paired = false
    this.state.pairedChatId = null
    this.state.phoneNumber = null
    this.qrCode = null
    await this.saveState()
  }

  protected async sendMessage(text: string): Promise<void> {
    if (!this.client || !this.state.pairedChatId) return
    await this.client.sendMessage(this.state.pairedChatId, text)
  }

  private async handleIncoming(msg: WAWebJS.Message): Promise<void> {
    if (msg.fromMe) return
    const chatId = msg.from
    const body = msg.body?.trim()
    if (!body) return

    // First message pairs the chat
    if (!this.state.pairedChatId) {
      this.state.pairedChatId = chatId
      this.state.paired = true
      await this.saveState()
      await this.client!.sendMessage(
        chatId,
        '\u2705 Vinculado! Mandame un mensaje para crear una tarea.'
      )
      return
    }

    // Only respond to paired chat
    if (chatId !== this.state.pairedChatId) return

    if (body.startsWith('/list')) {
      const tasks = this.taskManager.list()
      await this.client!.sendMessage(chatId, formatTaskList(tasks))
      return
    }

    if (body.startsWith('/cancel ')) {
      const taskId = body.slice(8).trim()
      try {
        this.taskManager.cancel(taskId)
        await this.client!.sendMessage(chatId, `\u26d4 Tarea cancelada.`)
      } catch (e) {
        await this.client!.sendMessage(
          chatId,
          `Error: ${e instanceof Error ? e.message : String(e)}`
        )
      }
      return
    }

    if (body.startsWith('/status ')) {
      const taskId = body.slice(8).trim()
      const task = this.taskManager.get(taskId)
      if (!task) {
        await this.client!.sendMessage(chatId, '\u{1f50d} Tarea no encontrada.')
        return
      }
      await this.client!.sendMessage(chatId, formatTaskSummary(task))
      return
    }

    // Any other text = create task
    try {
      const task = await this.createTaskFromMessage(body)
      await this.client!.sendMessage(chatId, this.formatSummary(task))
    } catch (e) {
      await this.client!.sendMessage(
        chatId,
        `No se pudo crear la tarea: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  private settingsPath(): string {
    return join(getDataDir(), 'channels', 'whatsapp.json')
  }

  private async loadState(): Promise<WhatsAppState> {
    try {
      const raw = await readFile(this.settingsPath(), 'utf8')
      return { ...DEFAULT_STATE, ...JSON.parse(raw) }
    } catch {
      return { ...DEFAULT_STATE }
    }
  }

  private async saveState(): Promise<void> {
    const file = this.settingsPath()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(this.state, null, 2), 'utf8')
  }
}

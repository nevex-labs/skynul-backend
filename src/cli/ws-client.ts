import type { Task } from '../shared/types/task.js';

export type ServerEvent =
  | { type: 'connected'; payload: { ts: number } }
  | { type: 'task:update'; payload: { task: Task } }
  | { type: 'channel:update'; payload: unknown };

type EventHandler = (event: ServerEvent) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: EventHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  constructor(url: string) {
    this.url = url;
  }

  get connected(): boolean {
    return this._connected;
  }

  on(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  connect(): void {
    this.disconnect();

    const ws = new WebSocket(this.url);

    ws.addEventListener('open', () => {
      this._connected = true;
    });

    ws.addEventListener('message', (ev: MessageEvent) => {
      try {
        const event = JSON.parse(ev.data as string) as ServerEvent;
        for (const handler of this.handlers) handler(event);
      } catch {
        // ignore malformed messages
      }
    });

    ws.addEventListener('close', () => {
      this._connected = false;
      this.scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      this._connected = false;
    });

    this.ws = ws;
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }
}

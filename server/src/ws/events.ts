import type { WSContext } from 'hono/ws'

/**
 * Server-sent event types that mirror the Electron IPC events.
 * Clients receive these via WebSocket as JSON messages.
 */
export type ServerEvent =
  | { type: 'task:update'; payload: unknown }
  | { type: 'channel:update'; payload: unknown }
  | { type: 'connected'; payload: { ts: number } }

const clients = new Set<WSContext>()

/** Register a WebSocket client for event broadcasting. */
export function addClient(ws: WSContext): void {
  clients.add(ws)
}

/** Remove a WebSocket client. */
export function removeClient(ws: WSContext): void {
  clients.delete(ws)
}

/** Broadcast an event to all connected clients. */
export function broadcast(event: ServerEvent): void {
  const msg = JSON.stringify(event)
  for (const ws of clients) {
    try {
      ws.send(msg)
    } catch {
      clients.delete(ws)
    }
  }
}

/** Get connected client count (for health checks). */
export function clientCount(): number {
  return clients.size
}

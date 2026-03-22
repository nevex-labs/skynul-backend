export interface CoinbaseSession {
  sessionId: string
  accessToken: string
  refreshToken: string
  expiresAt: number // unix ms
  userId: string // coinbase user id
  displayName?: string
  avatarUrl?: string
}

// In-memory store — will be replaced with DB persistence later
const sessions = new Map<string, CoinbaseSession>()

export function setSession(session: CoinbaseSession): void {
  sessions.set(session.sessionId, session)
}

export function getSession(sessionId: string): CoinbaseSession | undefined {
  const s = sessions.get(sessionId)
  if (!s) return undefined
  if (Date.now() > s.expiresAt) {
    sessions.delete(sessionId)
    return undefined
  }
  return s
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export function updateSession(sessionId: string, patch: Partial<CoinbaseSession>): void {
  const s = sessions.get(sessionId)
  if (s) sessions.set(sessionId, { ...s, ...patch })
}

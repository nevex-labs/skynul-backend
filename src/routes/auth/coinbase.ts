import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { setSession, getSession, deleteSession } from '../../core/stores/session-store'

const COINBASE_AUTH_URL = 'https://www.coinbase.com/oauth/authorize'
const COINBASE_TOKEN_URL = 'https://api.coinbase.com/oauth/token'
const COINBASE_USER_URL = 'https://api.coinbase.com/v2/user'

function getConfig() {
  const clientId = process.env.COINBASE_OAUTH_CLIENT_ID
  const clientSecret = process.env.COINBASE_OAUTH_CLIENT_SECRET
  const redirectUri = process.env.COINBASE_OAUTH_REDIRECT_URI ?? 'http://localhost:3000/auth/coinbase/callback'
  if (!clientId || !clientSecret) throw new Error('COINBASE_OAUTH_CLIENT_ID and COINBASE_OAUTH_CLIENT_SECRET are required')
  return { clientId, clientSecret, redirectUri }
}

// Temporary CSRF state store — replaced with DB later
const pendingStates = new Map<string, number>()

export const coinbaseAuthGroup = new Hono()

// GET /auth/coinbase — redirect to Coinbase OAuth
coinbaseAuthGroup.get('/', (c) => {
  const { clientId, redirectUri } = getConfig()
  const state = randomBytes(16).toString('hex')
  pendingStates.set(state, Date.now() + 1000 * 60 * 10) // 10 min expiry

  const url = new URL(COINBASE_AUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', 'wallet:user:read wallet:accounts:read wallet:transactions:read')
  url.searchParams.set('state', state)

  return c.redirect(url.toString())
})

// GET /auth/coinbase/callback — exchange code for tokens
coinbaseAuthGroup.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) return c.json({ error }, 400)
  if (!code || !state) return c.json({ error: 'Missing code or state' }, 400)

  const stateExpiry = pendingStates.get(state)
  if (!stateExpiry || Date.now() > stateExpiry) return c.json({ error: 'Invalid or expired state' }, 400)
  pendingStates.delete(state)

  const { clientId, clientSecret, redirectUri } = getConfig()

  const tokenRes = await fetch(COINBASE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    return c.json({ error: `Token exchange failed: ${err}` }, 400)
  }

  const tokens = await tokenRes.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  // Fetch Coinbase user info
  const userRes = await fetch(COINBASE_USER_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const userData = await userRes.json() as { data: { id: string; name: string; avatar_url?: string } }

  const sessionId = randomBytes(32).toString('hex')
  setSession({
    sessionId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    userId: userData.data.id,
    displayName: userData.data.name,
    avatarUrl: userData.data.avatar_url,
  })

  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
  return c.redirect(`${frontendUrl}/auth/callback?sessionId=${sessionId}`)
})

// GET /auth/coinbase/session — validate sessionId and return user
coinbaseAuthGroup.get('/session', (c) => {
  const sessionId = c.req.header('X-Session-Id')
  if (!sessionId) return c.json({ error: 'Missing session' }, 401)
  const session = getSession(sessionId)
  if (!session) return c.json({ error: 'Invalid or expired session' }, 401)
  return c.json({ user: { id: session.userId, name: session.displayName ?? session.userId } })
})

// POST /auth/coinbase/logout
coinbaseAuthGroup.post('/logout', (c) => {
  const sessionId = c.req.header('X-Session-Id')
  if (sessionId) deleteSession(sessionId)
  return c.json({ ok: true })
})

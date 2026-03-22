import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { setSession, deleteSession, getSession } from '../../core/stores/session-store'

// address -> { nonce, expiresAt }
const pendingNonces = new Map<string, { nonce: string; expiresAt: number }>()

export const walletAuthGroup = new Hono()

// GET /auth/wallet/nonce?address=0x...
walletAuthGroup.get('/nonce', (c) => {
  const address = c.req.query('address')?.toLowerCase()
  if (!address) return c.json({ error: 'Missing address' }, 400)

  const nonce = randomBytes(16).toString('hex')
  pendingNonces.set(address, { nonce, expiresAt: Date.now() + 1000 * 60 * 5 }) // 5 min

  return c.json({ nonce, message: `Sign in to Skynul: ${nonce}` })
})

// POST /auth/wallet/verify { address, signature }
walletAuthGroup.post('/verify', async (c) => {
  const { address, signature } = await c.req.json<{ address: string; signature: string }>()
  if (!address || !signature) return c.json({ error: 'Missing address or signature' }, 400)

  const key = address.toLowerCase()
  const pending = pendingNonces.get(key)
  if (!pending || Date.now() > pending.expiresAt) return c.json({ error: 'Nonce expired or not found' }, 400)
  pendingNonces.delete(key)

  const { verifyMessage, JsonRpcProvider, Contract, hashMessage } = await import('ethers')
  const message = `Sign in to Skynul: ${pending.nonce}`

  const isValid = await (async () => {
    // EOA: standard 65-byte signature
    try {
      const recovered = (verifyMessage(message, signature) as string).toLowerCase()
      if (recovered === key) return true
    } catch { /* not EOA */ }

    // Smart Wallet (ERC-4337): EIP-1271 on-chain verification
    const rpcUrl = process.env.ETH_RPC_URL ?? 'https://mainnet.base.org'
    const provider = new JsonRpcProvider(rpcUrl)
    const contract = new Contract(key, ['function isValidSignature(bytes32,bytes) view returns (bytes4)'], provider)
    const msgHash = hashMessage(message)
    try {
      const result = await contract.isValidSignature(msgHash, signature)
      return result === '0x1626ba7e'
    } catch { return false }
  })()

  if (!isValid) return c.json({ error: 'Invalid signature' }, 401)

  const sessionId = randomBytes(32).toString('hex')
  setSession({
    sessionId,
    accessToken: '',
    refreshToken: '',
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
    userId: address,
    displayName: `${address.slice(0, 6)}...${address.slice(-4)}`,
  })

  return c.json({ sessionId, user: { id: address, name: `${address.slice(0, 6)}...${address.slice(-4)}` } })
})

// GET /auth/wallet/session
walletAuthGroup.get('/session', (c) => {
  const sessionId = c.req.header('X-Session-Id')
  if (!sessionId) return c.json({ error: 'Missing session' }, 401)
  const session = getSession(sessionId)
  if (!session) return c.json({ error: 'Invalid or expired session' }, 401)
  return c.json({ user: { id: session.userId, name: session.displayName ?? session.userId } })
})

// POST /auth/wallet/logout
walletAuthGroup.post('/logout', (c) => {
  const sessionId = c.req.header('X-Session-Id')
  if (sessionId) deleteSession(sessionId)
  return c.json({ ok: true })
})

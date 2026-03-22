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

  const { createPublicClient, http, hashMessage, encodeFunctionData, decodeFunctionResult } = await import('viem')
  const { base } = await import('viem/chains')
  const message = `Sign in to Skynul: ${pending.nonce}`

  const rpcUrl = process.env.ETH_RPC_URL ?? 'https://mainnet.base.org'
  const client = createPublicClient({ chain: base, transport: http(rpcUrl) })

  const hash = hashMessage(message)

  let isValid = false
  try {
    // ERC-6492 Universal Signature Verifier — deployed on all EVM chains
    const UNIVERSAL_SIG_VERIFIER = '0x7DD271fA79df3a5Feb99F73BebFA4395b2E4F4Be' as `0x${string}`
    const abi = [{
      name: 'isValidSig',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: '_signer', type: 'address' },
        { name: '_hash', type: 'bytes32' },
        { name: '_signature', type: 'bytes' },
      ],
      outputs: [{ name: '', type: 'bool' }],
    }] as const

    const data = encodeFunctionData({
      abi,
      functionName: 'isValidSig',
      args: [key as `0x${string}`, hash, signature as `0x${string}`],
    })

    const result = await client.call({
      to: UNIVERSAL_SIG_VERIFIER,
      data,
    })

    if (result.data) {
      isValid = decodeFunctionResult({ abi, functionName: 'isValidSig', data: result.data }) as boolean
    }
  } catch (err: any) {
    console.error('[verify] ERC-6492 verification error:', err?.shortMessage ?? err?.message ?? err)
  }
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

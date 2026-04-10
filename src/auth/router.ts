import { Hono } from 'hono';
import { generateSiweNonce, siweMessage, verifySiweSignature } from './middleware';

const auth = new Hono();

// Public: Get challenge
auth.get('/challenge', async (c) => {
  const wallet = c.req.query('wallet');
  const chain = c.req.query('chain') || 'ethereum';

  if (!wallet) {
    return c.json({ error: 'wallet required' }, 400);
  }

  const host = c.req.header('host') ?? 'localhost:3141';
  const proto = c.req.header('x-forwarded-proto') ?? 'http';
  const nonce = generateSiweNonce();
  const message = siweMessage({
    domain: host.split(':')[0] ?? 'localhost',
    address: wallet,
    statement: 'Sign in to Skynul',
    uri: `${proto}://${host}/auth/challenge?chain=${encodeURIComponent(chain)}`,
    chainId: 1,
    nonce,
  });

  return c.json({ message, nonce });
});

// Public: Verify signature and get JWT
auth.post('/verify', async (c) => {
  const body = await c.req.json();
  const { message, signature, wallet, chain } = body;

  if (!message || !signature || !wallet) {
    return c.json({ error: 'message, signature, wallet required' }, 400);
  }

  const isValid = await verifySiweSignature(message, signature, wallet);
  if (!isValid) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  // TODO: Upsert user in DB

  // Create simple JWT (for now)
  const payload = Buffer.from(JSON.stringify({ wallet, chain }), 'utf8').toString('base64url');
  const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.mock`;

  return c.json({ token });
});

// Protected: Get current user
auth.get('/me', async (c) => {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'No token' }, 401);
  }

  const token = auth.slice(7);
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return c.json(payload);
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
});

export default auth;

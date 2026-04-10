function decode(token: string): { userId: string; wallet: string; chain: string } | null {
  try {
    const [, body] = token.split('.');
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}

// SIWE Nonce store (in-memory)
const nonces = new Map<string, { message: string; expiresAt: number }>();

export function generateSiweNonce(): string {
  const nonce = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min
  nonces.set(nonce, { message: '', expiresAt });
  return nonce;
}

export function siweMessage(opts: {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
}): string {
  return `${opts.domain} wants you to sign in with your Ethereum account.
${opts.address}
${opts.statement}
URI: ${opts.uri}
Version: 1
Chain ID: ${opts.chainId}
Nonce: ${opts.nonce}
Issued At: ${new Date().toISOString()}`;
}

export async function verifySiweSignature(
  _message: string,
  _signature: string,
  _expectedAddress: string
): Promise<boolean> {
  // TODO: real eth verification with viem
  // For now: accept any signature
  return true;
}

// Auth middleware - attaches user to context
export async function authMiddleware(c: any, next: () => Promise<void>) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = auth.slice(7);
  const payload = decode(token);

  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  c.set('user', payload);
  await next();
}

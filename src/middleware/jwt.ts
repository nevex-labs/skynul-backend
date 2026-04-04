import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';

const JWT_SECRET = process.env.JWT_SECRET || process.env.MASTER_KEY || 'skynul-dev-secret';

export interface JwtPayload {
  userId: number;
  walletAddress?: string;
  chain?: string;
  email?: string;
  iat: number;
  exp: number;
}

export const jwtMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  // No token = dev mode, skip
  if (!authHeader?.startsWith('Bearer ')) {
    await next();
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verify(token, JWT_SECRET, 'HS256');
    c.set('jwtPayload', payload as unknown as JwtPayload);
  } catch {
    // Invalid token — let the route handler decide what to do
    c.set('jwtPayload', null);
  }

  await next();
});

/**
 * Helper para extraer userId del JWT payload en handlers Effect.
 * Retorna null si no hay token válido.
 */
export function getJwtUserId(c: any): number | null {
  const payload = c.get('jwtPayload') as JwtPayload | null;
  return payload?.userId ?? null;
}

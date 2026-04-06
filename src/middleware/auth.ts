import { timingSafeEqual } from 'crypto';
import { createMiddleware } from 'hono/factory';

export const authMiddleware = createMiddleware(async (c, next) => {
  const requiredToken = process.env.SKYNUL_API_TOKEN;

  // No token configured = local dev mode, allow all (backward compatible)
  if (!requiredToken) {
    await next();
    return;
  }

  const path = c.req.path;
  if (path === '/ping' || path === '/health' || path === '/metrics') {
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice(7);
  if (!safeCompare(token, requiredToken)) {
    return c.json({ error: 'Invalid token' }, 403);
  }

  await next();
});

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

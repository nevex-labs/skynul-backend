import { createMiddleware } from 'hono/factory';

/**
 * Auth middleware — placeholder for future JWT/token validation.
 *
 * Desktop mode: Electron spawns the server locally, no auth needed (or use a
 * shared secret passed via env var).
 *
 * Web mode: Validate JWT from Supabase/custom auth.
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  // TODO: Implement auth based on deployment context
  // For now, allow all requests (local dev / desktop)
  await next();
});

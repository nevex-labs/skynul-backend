import type { MiddlewareHandler } from 'hono';
import { logger } from '../core/logger';

/**
 * HTTP request logging middleware.
 * Logs method, path, status, duration. Skips /ping.
 */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  if (c.req.path === '/ping') return next();

  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  const level = c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info';

  logger[level]({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
  });
};

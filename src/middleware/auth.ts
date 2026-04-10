import { createMiddleware } from 'hono/factory';

export const authMiddleware = createMiddleware(async (_c, next) => {
  await next();
});

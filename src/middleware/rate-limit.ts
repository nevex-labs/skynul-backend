import type { MiddlewareHandler } from 'hono';
import { config } from '../core/config';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store (replace with Redis in production)
const store = new Map<string, RateLimitEntry>();

// Cleanup every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetTime <= now) {
        store.delete(key);
      }
    }
  },
  5 * 60 * 1000
);

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

export function createRateLimiter(options: RateLimiterOptions): MiddlewareHandler {
  const { windowMs, maxRequests, keyGenerator } = options;

  return async (c, next) => {
    // Check env var directly for test compatibility
    if (process.env.SKYNUL_RATE_LIMIT_ENABLED === 'false') {
      return next();
    }

    const key = keyGenerator ? keyGenerator(c) : getDefaultKey(c);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetTime <= now) {
      entry = { count: 0, resetTime: now + windowMs };
    }

    entry.count++;
    store.set(key, entry);

    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

    c.header('X-RateLimit-Limit', maxRequests.toString());
    c.header('X-RateLimit-Remaining', remaining.toString());
    c.header('X-RateLimit-Reset', resetSeconds.toString());

    if (entry.count > maxRequests) {
      return c.json({ error: 'Rate limit exceeded', retryAfter: resetSeconds }, 429, {
        'Retry-After': resetSeconds.toString(),
      });
    }

    await next();
  };
}

function getDefaultKey(c: Parameters<MiddlewareHandler>[0]): string {
  const authHeader = c.req.header('Authorization');
  const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  return apiKey ? `key:${apiKey}` : `ip:${ip}`;
}

// Preset limiters
export const taskCreateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: config.rateLimit.tasksPerMin,
});

export const globalRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: config.rateLimit.globalRpm,
});

// WebSocket rate limit checker
export function checkWebSocketRateLimit(ip: string): { allowed: boolean; headers: Record<string, string> } {
  if (!config.rateLimit.enabled) {
    return { allowed: true, headers: {} };
  }

  const key = `ip:${ip}:ws`;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = config.rateLimit.websocketPerMin;

  let entry = store.get(key);
  if (!entry || entry.resetTime <= now) {
    entry = { count: 0, resetTime: now + windowMs };
  }

  entry.count++;
  store.set(key, entry);

  const remaining = Math.max(0, maxRequests - entry.count);
  const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

  const headers = {
    'X-RateLimit-Limit': maxRequests.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': resetSeconds.toString(),
  };

  return { allowed: entry.count <= maxRequests, headers };
}

// For testing
export function clearRateLimits(): void {
  store.clear();
}

export function getRateLimitCount(): number {
  return store.size;
}

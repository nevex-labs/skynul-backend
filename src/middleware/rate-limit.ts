import { createMiddleware } from 'hono/factory';
import { logger } from '../core/logger';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

// In-memory store (can be replaced with Redis for distributed setup)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetTime <= now) {
        rateLimitStore.delete(key);
      }
    }
  },
  5 * 60 * 1000
);

/**
 * Create a rate limiting middleware with custom configuration.
 *
 * @example
 * // Task creation limit: 10 per minute
 * const taskCreateLimiter = createRateLimitMiddleware({
 *   windowMs: 60 * 1000,
 *   maxRequests: 10,
 *   keyPrefix: 'task:create'
 * });
 *
 * @example
 * // Message limit: 20 per minute per task
 * const messageLimiter = createRateLimitMiddleware({
 *   windowMs: 60 * 1000,
 *   maxRequests: 20,
 *   keyPrefix: 'task:message'
 * });
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  return createMiddleware(async (c, next) => {
    // Skip if rate limiting is disabled globally
    if (process.env.SKYNUL_RATE_LIMIT_ENABLED === 'false') {
      await next();
      return;
    }

    // Get identifier from API key or IP
    const authHeader = c.req.header('Authorization');
    const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    const baseIdentifier = apiKey ? `key:${apiKey}` : `ip:${ip}`;

    // Build key with optional prefix and path params
    let identifier = baseIdentifier;
    if (config.keyPrefix) {
      identifier = `${baseIdentifier}:${config.keyPrefix}`;
    }

    // Add task ID if present in params
    const taskId = c.req.param('id');
    if (taskId) {
      identifier = `${identifier}:${taskId}`;
    }

    const now = Date.now();
    let entry = rateLimitStore.get(identifier);

    // Reset if window has passed
    if (!entry || entry.resetTime <= now) {
      entry = {
        count: 0,
        resetTime: now + config.windowMs,
      };
    }

    entry.count++;
    rateLimitStore.set(identifier, entry);

    // Calculate remaining requests and reset time
    const remaining = Math.max(0, config.maxRequests - entry.count);
    const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

    // Set headers
    c.header('X-RateLimit-Limit', config.maxRequests.toString());
    c.header('X-RateLimit-Remaining', remaining.toString());
    c.header('X-RateLimit-Reset', resetSeconds.toString());

    // Check if limit exceeded
    if (entry.count > config.maxRequests) {
      logger.warn({ identifier, path: c.req.path, count: entry.count }, 'Rate limit exceeded');

      return c.json(
        {
          error: 'Rate limit exceeded',
          retryAfter: resetSeconds,
        },
        429,
        {
          'Retry-After': resetSeconds.toString(),
        }
      );
    }

    await next();
  });
}

// Preset configurations for common use cases
export const rateLimitPresets = {
  // Task creation: 10 per minute
  taskCreate: {
    windowMs: 60 * 1000,
    maxRequests: 10,
    keyPrefix: 'task:create',
  },
  // Messages: 20 per minute per task
  taskMessage: {
    windowMs: 60 * 1000,
    maxRequests: 20,
    keyPrefix: 'task:message',
  },
  // Resume: 5 per minute per task
  taskResume: {
    windowMs: 60 * 1000,
    maxRequests: 5,
    keyPrefix: 'task:resume',
  },
  // WebSocket connections: 10 per IP
  websocket: {
    windowMs: 60 * 1000,
    maxRequests: 10,
    keyPrefix: 'ws:connect',
  },
  // Global API: 100 per minute
  global: {
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyPrefix: 'global',
  },
} satisfies Record<string, RateLimitConfig>;

// Global rate limit middleware (for general use)
export const globalRateLimitMiddleware = createRateLimitMiddleware(rateLimitPresets.global);

// Legacy middleware for backward compatibility (uses global preset)
export const rateLimitMiddleware = globalRateLimitMiddleware;

// WebSocket rate limit check
export function checkWebSocketRateLimit(ip: string): { allowed: boolean; headers: Record<string, string> } {
  if (process.env.SKYNUL_RATE_LIMIT_ENABLED === 'false') {
    return { allowed: true, headers: {} };
  }

  const config = rateLimitPresets.websocket;
  const identifier = `ip:${ip}:${config.keyPrefix}`;
  const now = Date.now();

  let entry = rateLimitStore.get(identifier);

  if (!entry || entry.resetTime <= now) {
    entry = {
      count: 0,
      resetTime: now + config.windowMs,
    };
  }

  entry.count++;
  rateLimitStore.set(identifier, entry);

  const remaining = Math.max(0, config.maxRequests - entry.count);
  const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

  const headers = {
    'X-RateLimit-Limit': config.maxRequests.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': resetSeconds.toString(),
  };

  if (entry.count > config.maxRequests) {
    logger.warn({ identifier, count: entry.count }, 'WebSocket rate limit exceeded');
    return { allowed: false, headers };
  }

  return { allowed: true, headers };
}

// Clear rate limit for a specific identifier (admin use)
export function clearRateLimit(identifier: string): void {
  rateLimitStore.delete(identifier);
}

// Clear all rate limits (for testing)
export function clearAllRateLimits(): void {
  rateLimitStore.clear();
}

// Get all rate limit entries count (for monitoring)
export function getRateLimitStoreSize(): number {
  return rateLimitStore.size;
}

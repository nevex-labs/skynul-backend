import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRateLimits, createRateLimiter, globalRateLimiter, taskCreateLimiter } from './rate-limit';

describe('rate limiting', () => {
  let app: Hono;

  beforeEach(() => {
    clearRateLimits();
    process.env.SKYNUL_RATE_LIMIT_ENABLED = 'true';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearRateLimits();
  });

  describe('global rate limiting', () => {
    beforeEach(() => {
      app = new Hono();
      app.use(globalRateLimiter);
      app.get('/test', (c) => c.json({ success: true }));
    });

    it('allows requests within limit', async () => {
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer test-key' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('99');
    });

    it('blocks requests exceeding limit', async () => {
      const headers = { Authorization: 'Bearer test-key' };

      for (let i = 0; i < 100; i++) {
        const res = await app.request('/test', { headers });
        expect(res.status).toBe(200);
      }

      const res = await app.request('/test', { headers });
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({
        error: 'Rate limit exceeded',
        retryAfter: expect.any(Number),
      });
    });

    it('tracks different API keys separately', async () => {
      const key1 = 'Bearer key-1';
      const key2 = 'Bearer key-2';

      for (let i = 0; i < 100; i++) {
        await app.request('/test', { headers: { Authorization: key1 } });
      }

      const res1 = await app.request('/test', { headers: { Authorization: key1 } });
      expect(res1.status).toBe(429);

      const res2 = await app.request('/test', { headers: { Authorization: key2 } });
      expect(res2.status).toBe(200);
    });

    it('can be disabled via env var', async () => {
      process.env.SKYNUL_RATE_LIMIT_ENABLED = 'false';

      for (let i = 0; i < 150; i++) {
        const res = await app.request('/test', {
          headers: { Authorization: 'Bearer test-key' },
        });
        expect(res.status).toBe(200);
      }
    });
  });

  describe('task creation rate limiting', () => {
    beforeEach(() => {
      app = new Hono();
      app.post('/tasks', taskCreateLimiter, (c) => c.json({ success: true }));
    });

    it('allows up to 10 task creations per minute', async () => {
      const headers = { Authorization: 'Bearer test-key' };

      for (let i = 0; i < 10; i++) {
        const res = await app.request('/tasks', { method: 'POST', headers });
        expect(res.status).toBe(200);
      }

      const res = await app.request('/tasks', { method: 'POST', headers });
      expect(res.status).toBe(429);
    });
  });

  describe('rate limit reset after window', () => {
    beforeEach(() => {
      app = new Hono();
      app.use(createRateLimiter({ windowMs: 1000, maxRequests: 5 }));
      app.get('/test', (c) => c.json({ success: true }));
    });

    it('resets counter after window expires', async () => {
      vi.useFakeTimers();

      const headers = { Authorization: 'Bearer test-key' };

      for (let i = 0; i < 5; i++) {
        await app.request('/test', { headers });
      }

      const blocked = await app.request('/test', { headers });
      expect(blocked.status).toBe(429);

      vi.advanceTimersByTime(1100);

      const res = await app.request('/test', { headers });
      expect(res.status).toBe(200);

      vi.useRealTimers();
    });
  });
});

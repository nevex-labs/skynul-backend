import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllRateLimits, createRateLimitMiddleware, rateLimitPresets } from './rate-limit';

describe('rateLimitMiddleware', () => {
  let app: Hono;

  beforeEach(() => {
    clearAllRateLimits();
    process.env.SKYNUL_RATE_LIMIT_ENABLED = 'true';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearAllRateLimits();
  });

  describe('global rate limiting', () => {
    beforeEach(() => {
      app = new Hono();
      app.use(createRateLimitMiddleware(rateLimitPresets.global));
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

      // Make 100 requests (within limit)
      for (let i = 0; i < 100; i++) {
        const res = await app.request('/test', { headers });
        expect(res.status).toBe(200);
      }

      // 101st request should be blocked
      const res = await app.request('/test', { headers });
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({
        error: 'Rate limit exceeded',
        retryAfter: expect.any(Number),
      });
      expect(res.headers.get('Retry-After')).toBeDefined();
    });

    it('tracks different API keys separately', async () => {
      const key1 = 'Bearer key-1';
      const key2 = 'Bearer key-2';

      // Exhaust key1
      for (let i = 0; i < 100; i++) {
        await app.request('/test', { headers: { Authorization: key1 } });
      }

      // key1 should be blocked
      const res1 = await app.request('/test', { headers: { Authorization: key1 } });
      expect(res1.status).toBe(429);

      // key2 should still work
      const res2 = await app.request('/test', { headers: { Authorization: key2 } });
      expect(res2.status).toBe(200);
    });

    it('falls back to IP when no API key', async () => {
      // Make requests without API key
      for (let i = 0; i < 100; i++) {
        const res = await app.request('/test');
        expect(res.status).toBe(200);
      }

      // Should be blocked based on IP
      const res = await app.request('/test');
      expect(res.status).toBe(429);
    });

    it('can be disabled via env var', async () => {
      process.env.SKYNUL_RATE_LIMIT_ENABLED = 'false';

      // Make many requests
      for (let i = 0; i < 150; i++) {
        const res = await app.request('/test', {
          headers: { Authorization: 'Bearer test-key' },
        });
        expect(res.status).toBe(200);
      }
    });

    it('includes proper rate limit headers', async () => {
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer test-key' },
      });

      expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('99');
      expect(res.headers.get('X-RateLimit-Reset')).toMatch(/^\d+$/);
    });
  });

  describe('task creation rate limiting', () => {
    beforeEach(() => {
      app = new Hono();
      app.post('/tasks', createRateLimitMiddleware(rateLimitPresets.taskCreate), (c) => c.json({ success: true }));
    });

    it('allows up to 10 task creations per minute', async () => {
      const headers = { Authorization: 'Bearer test-key' };

      for (let i = 0; i < 10; i++) {
        const res = await app.request('/tasks', { method: 'POST', headers });
        expect(res.status).toBe(200);
      }

      // 11th should be blocked
      const res = await app.request('/tasks', { method: 'POST', headers });
      expect(res.status).toBe(429);
    });
  });

  describe('task message rate limiting', () => {
    beforeEach(() => {
      app = new Hono();
      app.post('/tasks/:id/message', createRateLimitMiddleware(rateLimitPresets.taskMessage), (c) =>
        c.json({ success: true })
      );
    });

    it('allows up to 20 messages per minute per task', async () => {
      const headers = { Authorization: 'Bearer test-key' };

      for (let i = 0; i < 20; i++) {
        const res = await app.request('/tasks/task-1/message', { method: 'POST', headers });
        expect(res.status).toBe(200);
      }

      // 21st should be blocked
      const res = await app.request('/tasks/task-1/message', { method: 'POST', headers });
      expect(res.status).toBe(429);
    });

    it('tracks different tasks separately', async () => {
      const headers = { Authorization: 'Bearer test-key' };

      // Exhaust limit on task-1
      for (let i = 0; i < 20; i++) {
        await app.request('/tasks/task-1/message', { method: 'POST', headers });
      }

      // task-1 should be blocked
      const res1 = await app.request('/tasks/task-1/message', { method: 'POST', headers });
      expect(res1.status).toBe(429);

      // task-2 should still work
      const res2 = await app.request('/tasks/task-2/message', { method: 'POST', headers });
      expect(res2.status).toBe(200);
    });
  });

  describe('task resume rate limiting', () => {
    beforeEach(() => {
      app = new Hono();
      app.post('/tasks/:id/resume', createRateLimitMiddleware(rateLimitPresets.taskResume), (c) =>
        c.json({ success: true })
      );
    });

    it('allows up to 5 resumes per minute per task', async () => {
      const headers = { Authorization: 'Bearer test-key' };

      for (let i = 0; i < 5; i++) {
        const res = await app.request('/tasks/task-1/resume', { method: 'POST', headers });
        expect(res.status).toBe(200);
      }

      // 6th should be blocked
      const res = await app.request('/tasks/task-1/resume', { method: 'POST', headers });
      expect(res.status).toBe(429);
    });
  });

  describe('rate limit reset after window', () => {
    beforeEach(() => {
      app = new Hono();
      app.use(createRateLimitMiddleware({ windowMs: 1000, maxRequests: 5 }));
      app.get('/test', (c) => c.json({ success: true }));
    });

    it('resets counter after window expires', async () => {
      vi.useFakeTimers();

      const headers = { Authorization: 'Bearer test-key' };

      // Exhaust limit
      for (let i = 0; i < 5; i++) {
        await app.request('/test', { headers });
      }

      // Should be blocked
      const blocked = await app.request('/test', { headers });
      expect(blocked.status).toBe(429);

      // Advance time past window
      vi.advanceTimersByTime(1100);

      // Should work again
      const res = await app.request('/test', { headers });
      expect(res.status).toBe(200);

      vi.useRealTimers();
    });
  });
});

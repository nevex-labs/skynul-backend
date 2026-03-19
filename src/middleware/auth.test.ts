import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware } from './auth';

function makeApp() {
  const app = new Hono();
  app.use(authMiddleware);
  app.get('/ping', (c) => c.json({ status: 'ok' }));
  app.get('/ws', (c) => c.json({ status: 'ok' }));
  app.get('/api/tasks', (c) => c.json({ tasks: [] }));
  return app;
}

describe('authMiddleware', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('without SKYNUL_API_TOKEN (local dev mode)', () => {
    beforeEach(() => {
      vi.stubEnv('SKYNUL_API_TOKEN', '');
    });

    it('allows all requests without any auth header', async () => {
      const app = makeApp();
      const res = await app.request('/api/tasks');
      expect(res.status).toBe(200);
    });

    it('allows /ping without auth', async () => {
      const app = makeApp();
      const res = await app.request('/ping');
      expect(res.status).toBe(200);
    });
  });

  describe('with SKYNUL_API_TOKEN set', () => {
    const TOKEN = 'secret-test-token-123';

    beforeEach(() => {
      vi.stubEnv('SKYNUL_API_TOKEN', TOKEN);
    });

    it('returns 401 when Authorization header is missing', async () => {
      const app = makeApp();
      const res = await app.request('/api/tasks');
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toMatch(/Missing or invalid/i);
    });

    it('returns 401 when Authorization header is not Bearer scheme', async () => {
      const app = makeApp();
      const res = await app.request('/api/tasks', {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(res.status).toBe(401);
    });

    it('returns 403 when token is wrong', async () => {
      const app = makeApp();
      const res = await app.request('/api/tasks', {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/Invalid token/i);
    });

    it('allows request with correct token', async () => {
      const app = makeApp();
      const res = await app.request('/api/tasks', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(200);
    });

    it('allows /ping without auth even when token is set', async () => {
      const app = makeApp();
      const res = await app.request('/ping');
      expect(res.status).toBe(200);
    });

    it('allows /ws without auth even when token is set', async () => {
      const app = makeApp();
      const res = await app.request('/ws');
      expect(res.status).toBe(200);
    });
  });
});

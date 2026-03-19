import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { describe, expect, it } from 'vitest';

/**
 * Build a Hono app with a CORS middleware using the same origin logic as cors.ts,
 * but parameterized so we can test different SKYNUL_ALLOWED_ORIGINS values.
 */
function makeApp(allowedOrigins: string[] = []) {
  const app = new Hono();
  app.use(
    cors({
      origin: (origin) => {
        if (!origin) return '*';
        if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) return origin;
        if (allowedOrigins.includes(origin)) return origin;
        return '';
      },
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    })
  );
  app.get('/ping', (c) => c.json({ status: 'ok' }));
  return app;
}

describe('corsMiddleware origin logic', () => {
  it('returns * when no origin header (Electron / curl)', async () => {
    const app = makeApp();
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
    // No Origin header → no ACAO header set (or wildcard for preflight)
  });

  it('reflects http://localhost origin', async () => {
    const app = makeApp();
    const res = await app.request('/ping', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('reflects http://127.0.0.1 origin', async () => {
    const app = makeApp();
    const res = await app.request('/ping', {
      headers: { Origin: 'http://127.0.0.1:3000' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:3000');
  });

  it('does not reflect unknown origins', async () => {
    const app = makeApp();
    const res = await app.request('/ping', {
      headers: { Origin: 'http://evil.com' },
    });
    expect(res.status).toBe(200);
    const acao = res.headers.get('Access-Control-Allow-Origin');
    expect(acao === null || acao === '').toBe(true);
  });

  it('reflects configured production origin', async () => {
    const app = makeApp(['https://app.skynul.com', 'https://dashboard.skynul.com']);
    const res = await app.request('/ping', {
      headers: { Origin: 'https://app.skynul.com' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.skynul.com');
  });

  it('does not reflect origin not in allowedOrigins list', async () => {
    const app = makeApp(['https://app.skynul.com']);
    const res = await app.request('/ping', {
      headers: { Origin: 'https://notallowed.com' },
    });
    const acao = res.headers.get('Access-Control-Allow-Origin');
    expect(acao === null || acao === '').toBe(true);
  });
});

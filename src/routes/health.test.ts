import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));

describe('Health endpoint', () => {
  it('returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: 'ok' });
  });
});

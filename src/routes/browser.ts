import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

// Browser snapshots storage (in-memory for now, could be SQLite)
const snapshots = new Map<
  string,
  {
    id: string;
    name: string;
    url: string;
    title: string;
    createdAt: number;
  }
>();

const browser = new Hono()
  .get('/snapshots', (c) => {
    const list = Array.from(snapshots.values());
    return c.json(list);
  })
  .post('/snapshots', zValidator('json', z.object({ name: z.string() })), async (c) => {
    const { name } = c.req.valid('json');

    // TODO: Implement actual browser snapshot logic
    // For now, return mock data
    const id = crypto.randomUUID();
    const snapshot = {
      id,
      name,
      url: 'https://example.com',
      title: 'Example Page',
      createdAt: Date.now(),
    };
    snapshots.set(id, snapshot);

    return c.json({ ok: true });
  })
  .post('/snapshots/:id/restore', (c) => {
    const id = c.req.param('id');
    const snapshot = snapshots.get(id);
    if (!snapshot) return c.json({ error: 'Snapshot not found' }, 404);

    // TODO: Implement actual restore logic
    return c.json({ ok: true });
  })
  .delete('/snapshots/:id', (c) => {
    const id = c.req.param('id');
    snapshots.delete(id);
    return c.json({ ok: true });
  });

export { browser };
export type BrowserRoute = typeof browser;

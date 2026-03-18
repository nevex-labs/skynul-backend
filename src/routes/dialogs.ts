import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

const dialogs = new Hono()
  .post('/open-files', async (c) => {
    // TODO: Implement file dialog
    // This requires Electron or a file picker library
    // For now, return empty
    return c.json({ canceled: true, filePaths: [] });
  })
  .post('/open-external', zValidator('json', z.object({ url: z.string().url() })), (c) => {
    const { url } = c.req.valid('json');

    // TODO: Implement open external
    // This requires Electron shell or child_process
    console.log('Open external:', url);

    return c.json({ ok: true });
  });

export { dialogs };
export type DialogsRoute = typeof dialogs;

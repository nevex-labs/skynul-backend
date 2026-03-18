import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { createScheduleId, loadSchedules, saveSchedules } from '../core/stores/schedule-store';
import type { Schedule } from '../types';

const scheduleSchema = z.object({
  id: z.string().optional(),
  prompt: z.string().min(1),
  capabilities: z.array(z.string()),
  mode: z.enum(['browser', 'code']),
  frequency: z.enum(['daily', 'weekly', 'custom']),
  cronExpr: z.string(),
  enabled: z.boolean().optional().default(true),
});

const schedules = new Hono()
  .get('/', async (c) => {
    return c.json({ schedules: await loadSchedules() });
  })
  .post('/', zValidator('json', scheduleSchema), async (c) => {
    const body = c.req.valid('json');
    const all = await loadSchedules();

    if (body.id) {
      const idx = all.findIndex((s) => s.id === body.id);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...body } as Schedule;
      }
    } else {
      all.push({
        ...body,
        id: createScheduleId(),
        lastRunAt: null,
        nextRunAt: Date.now(),
        createdAt: Date.now(),
      } as Schedule);
    }

    await saveSchedules(all);
    return c.json({ schedules: all });
  })
  .delete('/:id', async (c) => {
    const id = c.req.param('id');
    const all = (await loadSchedules()).filter((s) => s.id !== id);
    await saveSchedules(all);
    return c.json({ schedules: all });
  })
  .put('/:id/toggle', async (c) => {
    const id = c.req.param('id');
    const all = await loadSchedules();
    const s = all.find((sc) => sc.id === id);
    if (s) s.enabled = !s.enabled;
    await saveSchedules(all);
    return c.json({ schedules: all });
  });

export { schedules };
export type SchedulesRoute = typeof schedules;

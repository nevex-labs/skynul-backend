import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  projectAddTask,
  projectCreate,
  projectDelete,
  projectList,
  projectRemoveTask,
  projectUpdate,
} from '../../core/stores/project-store';

const projects = new Hono()
  .get('/', (c) => {
    return c.json({ projects: projectList() });
  })
  .post(
    '/',
    zValidator(
      'json',
      z.object({
        name: z.string().min(1),
        color: z.string().optional(),
      })
    ),
    (c) => {
      const { name, color } = c.req.valid('json');
      const project = projectCreate(name, color);
      return c.json(project);
    }
  )
  .put(
    '/:id',
    zValidator(
      'json',
      z.object({
        name: z.string().min(1),
        color: z.string(),
      })
    ),
    (c) => {
      const id = c.req.param('id');
      const { name, color } = c.req.valid('json');
      projectUpdate(id, name, color);
      return c.json({ ok: true });
    }
  )
  .delete('/:id', (c) => {
    const id = c.req.param('id');
    projectDelete(id);
    return c.json({ ok: true });
  })
  .post('/:id/tasks/:taskId', (c) => {
    const id = c.req.param('id');
    const taskId = c.req.param('taskId');
    projectAddTask(id, taskId);
    return c.json({ ok: true });
  })
  .delete('/:id/tasks/:taskId', (c) => {
    const id = c.req.param('id');
    const taskId = c.req.param('taskId');
    projectRemoveTask(id, taskId);
    return c.json({ ok: true });
  });

export { projects };
export type ProjectsRoute = typeof projects;

import { Hono } from 'hono';
import { taskCreateLimiter } from '../../middleware/rate-limit';
import { projects } from './projects';
import { taskManager, tasks } from './routes';
import { schedules } from './schedules';

const tasksGroup = new Hono()
  .use('/', async (c, next) => {
    // Apply rate limiting only to POST requests (task creation)
    if (c.req.method === 'POST') {
      return taskCreateLimiter(c, next);
    }
    return next();
  })
  .route('/', tasks)
  .route('/schedules', schedules)
  .route('/projects', projects);

export { tasksGroup, taskManager };
export type TasksGroup = typeof tasksGroup;

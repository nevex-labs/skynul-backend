import { Hono } from 'hono';
import { projects } from './projects';
import { taskManager, tasks } from './routes';
import { schedules } from './schedules';

const tasksGroup = new Hono().route('/', tasks).route('/projects', projects);

export { tasksGroup, taskManager, schedules };
export type TasksGroup = typeof tasksGroup;

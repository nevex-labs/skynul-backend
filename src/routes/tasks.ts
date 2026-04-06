import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../core/logger';
import { TASK_CAPABILITY_IDS } from '../types/capabilities';
import {
  createBrowserLoopSetup,
  createCdpLoopSetup,
  createCodeLoopSetup,
  createLoopRegistry,
  createPlaywrightBrowserEngineFactory,
  readSecret,
  type Task,
  type TaskCreateRequest,
  TaskManager,
  type TaskManagerOpts,
  TaskStore,
} from '../v2';

const loopRegistry = createLoopRegistry();

loopRegistry.register(
  'code',
  createCodeLoopSetup({
    shellRunner: {
      run: async (command, cwd, timeout) => {
        const { exec } = await import('node:child_process');
        return new Promise((resolve) => {
          exec(command, { cwd, timeout }, (error, stdout, stderr) => {
            if (error) {
              resolve(`[Error: ${stderr || error.message}]`);
            } else {
              resolve(stdout || '(no output)');
            }
          });
        });
      },
    },
  })
);

loopRegistry.register(
  'browser',
  createBrowserLoopSetup({ engineFactory: createPlaywrightBrowserEngineFactory() })
);
loopRegistry.register('cdp', createCdpLoopSetup({}));
loopRegistry.register('orchestrator', createCdpLoopSetup({}));

const taskStore = new TaskStore();

const managerOpts: TaskManagerOpts = {
  readSecret,
  loopRegistry,
  onTaskCreated: (task) => {
    logger.info({ taskId: task.id, status: task.status }, '[tasks] Task created');
  },
  onTaskUpdate: (task) => {
    logger.info({ taskId: task.id, status: task.status }, '[tasks] Task updated');
  },
  defaultMaxSteps: 50,
};

const taskManager = new TaskManager(taskStore, managerOpts);

export { taskManager };

const taskCapabilitySchema = z.enum(TASK_CAPABILITY_IDS);

const taskCreateSchema = z.object({
  prompt: z.string().min(1),
  capabilities: z.array(taskCapabilitySchema).optional(),
  attachments: z.array(z.string()).optional(),
  mode: z.enum(['browser', 'code', 'cdp', 'orchestrator']).optional(),
  maxSteps: z.number().optional(),
  model: z.string().optional(),
  agentSystemPrompt: z.string().optional(),
  agentAllowedTools: z.array(z.string()).optional(),
});

function errJson(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export const tasksRoutes = new Hono()
  .get('/', (c) => {
    const payload = c.get('jwtPayload') as { userId?: number } | null | undefined;
    const userId = payload?.userId;
    const response = { tasks: taskManager.list(userId) as Task[] };
    return c.json(response);
  })
  .get('/:id', (c) => {
    const id = c.req.param('id');
    if (!id) return errJson('Task ID is required', 400);
    const payload = c.get('jwtPayload') as { userId?: number } | null | undefined;
    const userId = payload?.userId;
    const task = taskManager.get(id);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    if (userId !== undefined && task.userId !== undefined && task.userId !== userId) {
      return c.json({ error: 'Task not found' }, 404);
    }
    return c.json(task);
  })
  .post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errJson('Invalid JSON body', 400);
    }
    const parsed = taskCreateSchema.safeParse(body);
    if (!parsed.success) {
      return errJson(parsed.error.message, 400);
    }
    const data = parsed.data;
    const payload = c.get('jwtPayload') as { userId?: number } | null | undefined;
    const userId = payload?.userId;

    const req: TaskCreateRequest = {
      prompt: data.prompt,
      capabilities: data.capabilities,
      attachments: data.attachments,
      mode: data.mode,
      maxSteps: data.maxSteps,
      model: data.model,
      agentSystemPrompt: data.agentSystemPrompt,
      agentAllowedTools: data.agentAllowedTools,
      userId,
    };

    let task: Task;
    try {
      task = await taskManager.create(req);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        '[tasks] Task operation error'
      );
      return errJson(error instanceof Error ? error.message : String(error), 400);
    }

    let approved: Task;
    try {
      approved = await taskManager.approve(task.id);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        '[tasks] Task operation error'
      );
      return errJson(error instanceof Error ? error.message : String(error), 400);
    }

    return c.json({ task: approved }, 201);
  })
  .post('/:id/approve', async (c) => {
    const id = c.req.param('id');
    if (!id) return errJson('Task ID is required', 400);
    try {
      const task = await taskManager.approve(id);
      return c.json({ task });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        '[tasks] Task operation error'
      );
      return errJson(error instanceof Error ? error.message : String(error), 400);
    }
  })
  .post('/:id/cancel', (c) => {
    const id = c.req.param('id');
    if (!id) return errJson('Task ID is required', 400);
    try {
      const task = taskManager.abort(id);
      return c.json({ task });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        '[tasks] Task operation error'
      );
      return errJson(error instanceof Error ? error.message : String(error), 400);
    }
  })
  .delete('/:id', (c) => {
    const id = c.req.param('id');
    if (!id) return errJson('Task ID is required', 400);
    taskManager.delete(id);
    return c.json({ ok: true });
  })
  .post('/:id/resume', async (c) => {
    const id = c.req.param('id');
    if (!id) return errJson('Task ID is required', 400);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errJson('Invalid JSON body', 400);
    }
    if (!body || typeof body !== 'object' || typeof (body as { message?: unknown }).message !== 'string') {
      return errJson('message is required', 400);
    }
    try {
      const task = await taskManager.resume(id, (body as { message: string }).message);
      return c.json({ task });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        '[tasks] Task operation error'
      );
      return errJson(error instanceof Error ? error.message : String(error), 400);
    }
  });

export type TasksRoutes = typeof tasksRoutes;

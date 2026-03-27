import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { inferTaskSetup } from '../../core/agent/task-inference';
import { TaskManager } from '../../core/agent/task-manager';
import { dispatchChat } from '../../core/providers/dispatch';
import { TASK_CAPABILITY_IDS, type TaskCreateRequest, type TaskListResponse } from '../../types';
import { policyState } from '../agent/policy';

const tm = new TaskManager();
tm.setPolicyGetter(() => policyState);

/** Expose the TaskManager instance for use by other modules (e.g., channels). */
export { tm as taskManager };

const taskCapabilitySchema = z.enum(TASK_CAPABILITY_IDS);

const taskCreateSchema = z.object({
  prompt: z.string().min(1),
  // If omitted/empty, the backend can infer sensible defaults.
  capabilities: z.array(taskCapabilitySchema).optional(),
  attachments: z.array(z.string()).optional(),
  mode: z.enum(['browser', 'code']).optional(),
  infer: z.boolean().optional(),
  inferStrategy: z.enum(['auto', 'rules', 'llm']).optional(),
  maxSteps: z.number().optional(),
  timeoutMs: z.number().optional(),
  source: z.enum(['desktop', 'telegram', 'discord', 'slack', 'whatsapp', 'signal']).optional(),
  parentTaskId: z.string().optional(),
  agentName: z.string().optional(),
  agentRole: z.string().optional(),
  orchestrate: z.boolean().optional(),
  model: z.string().optional(),
  skipMemory: z.boolean().optional(),
});

const tasks = new Hono()
  .post(
    '/infer',
    zValidator(
      'json',
      z.object({
        prompt: z.string().min(1),
        attachments: z.array(z.string()).optional(),
        strategy: z.enum(['auto', 'rules', 'llm']).optional(),
      })
    ),
    async (c) => {
      const { prompt, attachments, strategy } = c.req.valid('json');
      const inferred = await inferTaskSetup({
        input: { prompt, attachments },
        strategy,
        chat: (messages) => dispatchChat(policyState.provider.active, messages),
      });
      return c.json(inferred);
    }
  )
  .get('/', (c) => {
    const response: TaskListResponse = { tasks: tm.list() };
    return c.json(response);
  })
  .get('/:id', (c) => {
    const id = c.req.param('id');
    const task = tm.get(id);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task);
  })
  .post('/', zValidator('json', taskCreateSchema), async (c) => {
    const body = c.req.valid('json');
    try {
      const infer = body.infer ?? true;
      if (!infer && !body.mode) {
        return c.json({ error: 'mode is required when infer=false' }, 400);
      }
      const needsInference = infer && ((body.capabilities?.length ?? 0) === 0 || body.mode === undefined);
      const inferred = needsInference
        ? await inferTaskSetup({
            input: { prompt: body.prompt, attachments: body.attachments },
            strategy: body.inferStrategy,
            chat: (messages) => dispatchChat(policyState.provider.active, messages),
          })
        : null;

      const capabilities =
        infer && (!body.capabilities || body.capabilities.length === 0)
          ? (inferred?.capabilities ?? [])
          : (body.capabilities ?? []);

      const mode = infer && !body.mode ? (inferred?.mode ?? 'browser') : (body.mode ?? 'browser');

      const req: TaskCreateRequest = {
        prompt: body.prompt,
        capabilities,
        attachments: body.attachments,
        mode,
        maxSteps: body.maxSteps,
        timeoutMs: body.timeoutMs,
        source: body.source,
        parentTaskId: body.parentTaskId,
        agentName: body.agentName,
        agentRole: body.agentRole,
        orchestrate: body.orchestrate,
        model: body.model,
        skipMemory: body.skipMemory,
      };

      console.log(`[task-create] capabilities=${JSON.stringify(capabilities)}, mode=${mode}, runner will be=${capabilities.some(c => c.endsWith('.trading')) ? 'cdp' : 'browser'}`);
      const task = tm.create(req);

      // Auto-approve: permissions are managed in settings, no need for manual approval.
      const approved = await tm.approve(task.id);
      return c.json({ task: approved });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  })
  .post('/:id/approve', async (c) => {
    const id = c.req.param('id');
    try {
      const task = await tm.approve(id);
      return c.json({ task });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  })
  .post('/:id/cancel', (c) => {
    const id = c.req.param('id');
    try {
      const task = tm.cancel(id);
      return c.json({ task });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  })
  .delete('/:id', (c) => {
    const id = c.req.param('id');
    tm.delete(id);
    return c.json({ ok: true });
  })
  .post('/:id/message', zValidator('json', z.object({ message: z.string() })), (c) => {
    const id = c.req.param('id');
    const { message } = c.req.valid('json');
    try {
      tm.sendMessage(id, 'user', message);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  })
  .post('/:id/resume', zValidator('json', z.object({ message: z.string() })), async (c) => {
    const id = c.req.param('id');
    const { message } = c.req.valid('json');
    try {
      const task = await tm.resume(id, message);
      return c.json({ task });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  });

export { tasks };
export type TasksRoute = typeof tasks;

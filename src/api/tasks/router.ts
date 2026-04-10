import { Hono } from 'hono';
import { createTaskFromValidatedBody, taskManager } from '../../services/tasks';
import type { TaskMode } from '../../types';
import { TASK_CAPABILITY_IDS } from '../../types';

const VALID_MODES = new Set<TaskMode>(['web', 'sandbox']);

function validateTaskBody(body: unknown): string | null {
  if (!body || typeof (body as Record<string, unknown>).prompt !== 'string') {
    return 'prompt is required and must be a non-empty string';
  }
  const b = body as Record<string, unknown>;
  if (!String(b.prompt).trim()) return 'prompt is required and must be a non-empty string';
  if (b.mode !== undefined && !VALID_MODES.has(b.mode as TaskMode)) {
    return `mode must be one of: ${[...VALID_MODES].join(', ')}`;
  }
  if (b.capabilities !== undefined) {
    if (!Array.isArray(b.capabilities)) return 'capabilities must be an array';
    const allowed = TASK_CAPABILITY_IDS as readonly string[];
    const invalid = (b.capabilities as unknown[]).filter((cap) => typeof cap !== 'string' || !allowed.includes(cap));
    if (invalid.length > 0) return `unknown capabilities: ${(invalid as string[]).join(', ')}`;
  }
  return null;
}

const tasks = new Hono();

tasks.get('/', async (c) => {
  const list = taskManager.list();
  return c.json({ tasks: list });
});

tasks.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const err = validateTaskBody(body);
  if (err) return c.json({ error: err }, 400);
  const b = body as Record<string, unknown>;
  try {
    const task = await createTaskFromValidatedBody({
      prompt: String(b.prompt).trim(),
      capabilities: b.capabilities as never,
      attachments: Array.isArray(b.attachments) ? (b.attachments as string[]) : undefined,
      mode: b.mode as TaskMode | undefined,
      infer: b.infer !== false,
      inferStrategy: b.inferStrategy as never,
      orchestrate: b.orchestrate as never,
      model: typeof b.model === 'string' ? b.model : undefined,
      source: b.source as never,
      maxSteps: typeof b.maxSteps === 'number' ? b.maxSteps : undefined,
      timeoutMs: typeof b.timeoutMs === 'number' ? b.timeoutMs : undefined,
    });
    return c.json({ task }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Failed to create task' }, 400);
  }
});

tasks.get('/:id', async (c) => {
  const id = c.req.param('id');
  const task = taskManager.get(id);
  if (!task) return c.json({ error: 'Not found' }, 404);
  return c.json({ task });
});

tasks.post('/:id/approve', async (c) => {
  const id = c.req.param('id');
  try {
    const task = await taskManager.approve(id);
    return c.json({ task });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Failed' }, 400);
  }
});

tasks.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const task = taskManager.cancel(id);
    return c.json({ task });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Failed' }, 400);
  }
});

export default tasks;

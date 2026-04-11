import type { Context } from 'hono';
import { Hono } from 'hono';
import { inferTaskSetup } from '../../core/agent/task-inference';
import { taskManager } from '../../core/agent/task-manager';
import { resolveActiveProvider } from '../../core/provider-resolver';
import { dispatchChat } from '../../core/providers/dispatch';
import type { TaskCreateRequest, TaskMode } from '../../types';
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

async function inferTaskCapabilities(body: {
  prompt: string;
  attachments?: string[];
  inferStrategy?: 'auto' | 'rules' | 'llm';
}) {
  return inferTaskSetup({
    input: { prompt: body.prompt, attachments: body.attachments },
    strategy: body.inferStrategy,
    chat: async (messages) => dispatchChat(await resolveActiveProvider(), messages),
  });
}

async function resolveInferredSetup(body: {
  prompt: string;
  mode?: TaskMode;
  capabilities?: TaskCreateRequest['capabilities'];
  attachments?: string[];
  inferStrategy?: 'auto' | 'rules' | 'llm';
}) {
  const missingCaps = !body.capabilities?.length;
  const missingMode = body.mode === undefined;
  if (!missingCaps && !missingMode) return { mode: body.mode, capabilities: body.capabilities };
  const inferred = await inferTaskCapabilities(body);
  return {
    mode: body.mode ?? inferred?.mode ?? 'web',
    capabilities: missingCaps ? (inferred?.capabilities ?? []) : (body.capabilities ?? []),
  };
}

const tasks = new Hono();

tasks.get('/', async (c) => {
  return c.json({ tasks: taskManager.list() });
});

type TaskBody = {
  prompt: string;
  mode?: TaskMode;
  capabilities?: TaskCreateRequest['capabilities'];
  attachments?: string[];
  infer?: boolean;
  inferStrategy?: 'auto' | 'rules' | 'llm';
  maxSteps?: number;
  timeoutMs?: number;
  source?: unknown;
  parentTaskId?: string;
  agentName?: string;
  agentRole?: string;
  orchestrate?: unknown;
  model?: string;
  skipMemory?: boolean;
};

function parseTaskBody(b: Record<string, unknown>): TaskBody {
  return {
    prompt: String(b.prompt).trim(),
    mode: b.mode as TaskMode | undefined,
    capabilities: b.capabilities as TaskCreateRequest['capabilities'] | undefined,
    attachments: Array.isArray(b.attachments) ? (b.attachments as string[]) : undefined,
    infer: b.infer as boolean | undefined,
    inferStrategy: b.inferStrategy as TaskBody['inferStrategy'],
    maxSteps: typeof b.maxSteps === 'number' ? b.maxSteps : undefined,
    timeoutMs: typeof b.timeoutMs === 'number' ? b.timeoutMs : undefined,
    source: b.source,
    parentTaskId: typeof b.parentTaskId === 'string' ? b.parentTaskId : undefined,
    agentName: typeof b.agentName === 'string' ? b.agentName : undefined,
    agentRole: typeof b.agentRole === 'string' ? b.agentRole : undefined,
    orchestrate: b.orchestrate,
    model: typeof b.model === 'string' ? b.model : undefined,
    skipMemory: typeof b.skipMemory === 'boolean' ? b.skipMemory : undefined,
  };
}

function buildTaskCreateInput(body: TaskBody): TaskCreateRequest {
  return {
    prompt: body.prompt,
    capabilities: body.capabilities,
    attachments: body.attachments,
    mode: body.mode,
    maxSteps: body.maxSteps,
    timeoutMs: body.timeoutMs,
    source: body.source as TaskCreateRequest['source'],
    parentTaskId: body.parentTaskId,
    agentName: body.agentName,
    agentRole: body.agentRole,
    orchestrate: body.orchestrate as TaskCreateRequest['orchestrate'],
    model: body.model,
    skipMemory: body.skipMemory,
  };
}

async function handleCreateTask(c: Context): Promise<Response> {
  const body = await c.req.json().catch(() => null);
  const err = validateTaskBody(body);
  if (err) return c.json({ error: err }, 400);
  const b = parseTaskBody(body as Record<string, unknown>);

  const shouldInfer = b.infer ?? true;
  if (!shouldInfer && !b.mode) return c.json({ error: 'mode is required when infer=false' }, 400);

  const { mode, capabilities } = shouldInfer
    ? await resolveInferredSetup({
        prompt: b.prompt,
        capabilities: b.capabilities,
        attachments: b.attachments,
        inferStrategy: b.inferStrategy,
      })
    : { mode: b.mode ?? ('web' as TaskMode), capabilities: b.capabilities ?? [] };

  try {
    const task = taskManager.create(buildTaskCreateInput({ ...b, mode, capabilities }));
    return c.json({ task }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Failed to create task' }, 400);
  }
}

tasks.post('/', async (c) => {
  return handleCreateTask(c);
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

import { zValidator } from '@hono/zod-validator'
import type { TaskListResponse } from '../types'
import { Hono } from 'hono'
import { z } from 'zod'
import { TaskManager } from '../core/agent/task-manager'
import { policyState } from './policy'

const tm = new TaskManager()
tm.setPolicyGetter(() => policyState)

/** Expose the TaskManager instance for use by other modules (e.g., channels). */
export { tm as taskManager }

const taskCreateSchema = z.object({
  prompt: z.string().min(1),
  capabilities: z.array(z.string()),
  attachments: z.array(z.string()).optional(),
  mode: z.enum(['browser', 'code']).optional().default('browser'),
  maxSteps: z.number().optional(),
  timeoutMs: z.number().optional(),
  source: z.enum(['desktop', 'telegram', 'discord', 'slack', 'whatsapp', 'signal']).optional(),
  parentTaskId: z.string().optional(),
  agentName: z.string().optional(),
  agentRole: z.string().optional()
})

const tasks = new Hono()
  .get('/', (c) => {
    const response: TaskListResponse = { tasks: tm.list() }
    return c.json(response)
  })
  .get('/:id', (c) => {
    const id = c.req.param('id')
    const task = tm.get(id)
    if (!task) return c.json({ error: 'Task not found' }, 404)
    return c.json(task)
  })
  .post('/', zValidator('json', taskCreateSchema), (c) => {
    const body = c.req.valid('json')
    try {
      const task = tm.create(body as any)
      return c.json({ task })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })
  .post('/:id/approve', async (c) => {
    const id = c.req.param('id')
    try {
      const task = await tm.approve(id)
      return c.json({ task })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })
  .post('/:id/cancel', (c) => {
    const id = c.req.param('id')
    try {
      const task = tm.cancel(id)
      return c.json({ task })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })
  .delete('/:id', (c) => {
    const id = c.req.param('id')
    tm.delete(id)
    return c.json({ ok: true })
  })
  .post('/:id/message', zValidator('json', z.object({ message: z.string() })), (c) => {
    const id = c.req.param('id')
    const { message } = c.req.valid('json')
    try {
      tm.sendMessage(id, 'user', message)
      return c.json({ ok: true })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })

export { tasks }
export type TasksRoute = typeof tasks

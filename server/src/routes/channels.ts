import { zValidator } from '@hono/zod-validator'
import type { ChannelId } from '../types'
import { Hono } from 'hono'
import { z } from 'zod'
import { ChannelManager } from '../core/channels/channel-manager'
import { taskManager } from './tasks'

const cm = new ChannelManager(taskManager)

// Load global settings and start enabled channels on init
void cm.loadGlobal().then(() => cm.startAll())

/** Expose the ChannelManager for graceful shutdown. */
export { cm as channelManager }

const channels = new Hono()
  .get('/', (c) => {
    return c.json({ channels: cm.getAllSettings() })
  })
  .get('/global', (c) => {
    return c.json(cm.getGlobalSettings())
  })
  .put(
    '/:id/enabled',
    zValidator(
      'json',
      z.object({
        enabled: z.boolean()
      })
    ),
    async (c) => {
      const id = c.req.param('id') as ChannelId
      try {
        const ch = cm.getChannel(id)
        const settings = await ch.setEnabled(c.req.valid('json').enabled)
        return c.json(settings)
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
      }
    }
  )
  .put('/:id/credentials', zValidator('json', z.record(z.string())), async (c) => {
    const id = c.req.param('id') as ChannelId
    const credentials = c.req.valid('json')
    try {
      const ch = cm.getChannel(id)
      await ch.setCredentials(credentials)
      return c.json({ ok: true })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })
  .post('/:id/pairing', async (c) => {
    const id = c.req.param('id') as ChannelId
    try {
      const ch = cm.getChannel(id)
      const code = await ch.generatePairingCode()
      return c.json({ code })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })
  .delete('/:id/pairing', async (c) => {
    const id = c.req.param('id') as ChannelId
    try {
      const ch = cm.getChannel(id)
      await ch.unpair()
      return c.json({ ok: true })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })
  .put(
    '/auto-approve',
    zValidator(
      'json',
      z.object({
        enabled: z.boolean()
      })
    ),
    async (c) => {
      const { enabled } = c.req.valid('json')
      const settings = await cm.setAutoApprove(enabled)
      return c.json(settings)
    }
  )

export { channels }
export type ChannelsRoute = typeof channels

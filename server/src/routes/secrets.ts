import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { getSecret, getSecretKeys, hasSecret, setSecret } from '../core/stores/secret-store'

const secrets = new Hono()
  .get('/keys', async (c) => {
    return c.json({ keys: await getSecretKeys() })
  })
  .get('/:key', async (c) => {
    const key = c.req.param('key')
    const value = await getSecret(key)
    return c.json({ value })
  })
  .put(
    '/:key',
    zValidator(
      'json',
      z.object({
        value: z.string()
      })
    ),
    async (c) => {
      const key = c.req.param('key')
      const { value } = c.req.valid('json')
      await setSecret(key, value)
      return c.json({ ok: true })
    }
  )
  .get('/:key/exists', async (c) => {
    const key = c.req.param('key')
    return c.json({ exists: await hasSecret(key) })
  })

export { secrets }
export type SecretsRoute = typeof secrets

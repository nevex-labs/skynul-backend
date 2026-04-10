import { Hono } from 'hono';
import { removeChannelConfig, saveChannelConfig } from '../../services/channels';

const channels = new Hono();

channels.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.channelKey !== 'string' || !body.channelKey.trim()) {
    return c.json({ error: 'channelKey is required' }, 400);
  }
  if (body.state === undefined || body.state === null || typeof body.state !== 'object') {
    return c.json({ error: 'state must be an object' }, 400);
  }
  await saveChannelConfig(body.channelKey, body.state as Record<string, unknown>);
  return c.json({ success: true }, 201);
});

channels.delete('/:channelKey', async (c) => {
  const channelKey = c.req.param('channelKey');
  await removeChannelConfig(channelKey);
  return c.json({ success: true });
});

export default channels;

import { Hono } from 'hono';

const PROMETEO_BASE_URL = 'https://banking.prometeoapi.net';

export const prometeoAuthGroup = new Hono();

/**
 * POST /auth/prometeo/login
 * Body: { provider: string; rut: string; password: string }
 * Authenticates with Prometeo and stores the session key in the secret store.
 */
prometeoAuthGroup.post('/login', async (c) => {
  const body = (await c.req.json()) as { provider?: string; rut?: string; password?: string };
  const { provider, rut, password } = body;

  if (!provider || !rut || !password) {
    return c.json({ error: 'provider, rut, and password are required' }, 400);
  }

  const res = await fetch(`${PROMETEO_BASE_URL}/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ provider, rut, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    return c.json({ error: `Prometeo login failed: ${res.status} ${text}` }, 400);
  }

  const data = (await res.json()) as { status: string; key?: string };
  if (!data.key) {
    return c.json({ error: `Prometeo login returned no session key: ${JSON.stringify(data)}` }, 400);
  }

  // Store session key
  const { setSecret } = await import('../../core/stores/secret-store');
  await setSecret('PROMETEO_SESSION_KEY', data.key);

  return c.json({ ok: true, status: data.status });
});

/**
 * POST /auth/prometeo/logout
 * Ends the Prometeo session and removes the stored session key.
 */
prometeoAuthGroup.post('/logout', async (c) => {
  const { getSecret, setSecret } = await import('../../core/stores/secret-store');
  const sessionKey = (await getSecret('PROMETEO_SESSION_KEY')) ?? '';

  if (sessionKey) {
    try {
      await fetch(`${PROMETEO_BASE_URL}/logout/`, {
        method: 'GET',
        headers: { 'X-Auth-Token': sessionKey },
      });
    } catch {
      // Best effort logout
    }
    await setSecret('PROMETEO_SESSION_KEY', '');
  }

  return c.json({ ok: true });
});

/**
 * GET /auth/prometeo/status
 * Returns whether a Prometeo session is currently active.
 */
prometeoAuthGroup.get('/status', async (c) => {
  const { getSecret } = await import('../../core/stores/secret-store');
  const sessionKey = (await getSecret('PROMETEO_SESSION_KEY')) ?? '';
  const apiKey = (await getSecret('PROMETEO_API_KEY')) ?? process.env.PROMETEO_API_KEY ?? '';

  return c.json({
    configured: !!apiKey,
    sessionActive: !!sessionKey,
  });
});

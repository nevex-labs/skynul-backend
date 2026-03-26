import { Hono } from 'hono';

const PLAID_BASE_URL = 'https://production.plaid.com';

export const plaidAuthGroup = new Hono();

/**
 * POST /auth/plaid/exchange
 * Body: { publicToken: string }
 * Exchanges a Plaid Link public token for a permanent access token and stores it.
 */
plaidAuthGroup.post('/exchange', async (c) => {
  const body = (await c.req.json()) as { publicToken?: string };
  const { publicToken } = body;

  if (!publicToken) {
    return c.json({ error: 'publicToken is required' }, 400);
  }

  const { getSecret, setSecret } = await import('../../core/stores/secret-store');
  const plaidClientId = (await getSecret('PLAID_CLIENT_ID')) ?? process.env.PLAID_CLIENT_ID ?? '';
  const plaidSecret = (await getSecret('PLAID_SECRET')) ?? process.env.PLAID_SECRET ?? '';

  if (!plaidClientId || !plaidSecret) {
    return c.json({ error: 'PLAID_CLIENT_ID and PLAID_SECRET not configured' }, 500);
  }

  const res = await fetch(`${PLAID_BASE_URL}/item/public_token/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: plaidClientId,
      secret: plaidSecret,
      public_token: publicToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return c.json({ error: `Plaid token exchange failed: ${res.status} ${text}` }, 400);
  }

  const data = (await res.json()) as { access_token: string; item_id: string };
  await setSecret('PLAID_ACCESS_TOKEN', data.access_token);

  return c.json({ ok: true, itemId: data.item_id });
});

/**
 * POST /auth/plaid/revoke
 * Revokes the Plaid access token and removes it from the secret store.
 */
plaidAuthGroup.post('/revoke', async (c) => {
  const { getSecret, setSecret } = await import('../../core/stores/secret-store');
  const plaidClientId = (await getSecret('PLAID_CLIENT_ID')) ?? process.env.PLAID_CLIENT_ID ?? '';
  const plaidSecret = (await getSecret('PLAID_SECRET')) ?? process.env.PLAID_SECRET ?? '';
  const accessToken = (await getSecret('PLAID_ACCESS_TOKEN')) ?? '';

  if (accessToken && plaidClientId && plaidSecret) {
    try {
      await fetch(`${PLAID_BASE_URL}/item/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: plaidClientId,
          secret: plaidSecret,
          access_token: accessToken,
        }),
      });
    } catch {
      // Best effort revoke
    }
    await setSecret('PLAID_ACCESS_TOKEN', '');
  }

  return c.json({ ok: true });
});

/**
 * GET /auth/plaid/status
 * Returns whether Plaid credentials are configured.
 */
plaidAuthGroup.get('/status', async (c) => {
  const { getSecret } = await import('../../core/stores/secret-store');
  const plaidClientId = (await getSecret('PLAID_CLIENT_ID')) ?? process.env.PLAID_CLIENT_ID ?? '';
  const plaidSecret = (await getSecret('PLAID_SECRET')) ?? process.env.PLAID_SECRET ?? '';
  const accessToken = (await getSecret('PLAID_ACCESS_TOKEN')) ?? '';

  return c.json({
    configured: !!(plaidClientId && plaidSecret),
    tokenActive: !!accessToken,
  });
});

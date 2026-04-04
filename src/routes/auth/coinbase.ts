import { randomBytes } from 'crypto';
import { Effect } from 'effect';
import { Hono } from 'hono';
import { AppLayer } from '../../config/layers';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { SessionService } from '../../services/sessions/tag';
import { SessionNotFoundError } from '../../shared/errors';

const COINBASE_AUTH_URL = 'https://www.coinbase.com/oauth/authorize';
const COINBASE_TOKEN_URL = 'https://api.coinbase.com/oauth/token';
const COINBASE_USER_URL = 'https://api.coinbase.com/v2/user';

function getConfig() {
  const clientId = process.env.COINBASE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.COINBASE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.COINBASE_OAUTH_REDIRECT_URI ?? 'http://localhost:3000/auth/coinbase/callback';
  if (!clientId || !clientSecret)
    throw new Error('COINBASE_OAUTH_CLIENT_ID and COINBASE_OAUTH_CLIENT_SECRET are required');
  return { clientId, clientSecret, redirectUri };
}

// Temporary CSRF state store
const pendingStates = new Map<string, number>();

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Coinbase auth error:', error);

  if (error?._tag === 'SessionNotFoundError') {
    return Http.unauthorized();
  }

  if (error instanceof Error) {
    return Http.badRequest(error.message);
  }

  return Http.internalError();
};

export const coinbaseAuthGroup = new Hono();

// GET /auth/coinbase — redirect to Coinbase OAuth
coinbaseAuthGroup.get('/', (c) => {
  try {
    const { clientId, redirectUri } = getConfig();
    const state = randomBytes(16).toString('hex');
    pendingStates.set(state, Date.now() + 1000 * 60 * 10); // 10 min expiry

    const url = new URL(COINBASE_AUTH_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'wallet:user:read wallet:accounts:read wallet:transactions:read');
    url.searchParams.set('state', state);

    return c.redirect(url.toString());
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// GET /auth/coinbase/callback — exchange code for tokens
coinbaseAuthGroup.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) return c.json({ error }, 400);
  if (!code || !state) return c.json({ error: 'Missing code or state' }, 400);

  const stateExpiry = pendingStates.get(state);
  if (!stateExpiry || Date.now() > stateExpiry) return c.json({ error: 'Invalid or expired state' }, 400);
  pendingStates.delete(state);

  const { clientId, clientSecret, redirectUri } = getConfig();

  return handler((ctx) =>
    Effect.gen(function* () {
      const tokenRes = yield* Effect.tryPromise({
        try: async () => {
          const res = await fetch(COINBASE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              grant_type: 'authorization_code',
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
            }),
          });

          if (!res.ok) {
            const err = await res.text();
            throw new Error(`Token exchange failed: ${err}`);
          }

          return res.json() as Promise<{
            access_token: string;
            refresh_token: string;
            expires_in: number;
          }>;
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });

      // Fetch Coinbase user info
      const userData = yield* Effect.tryPromise({
        try: async () => {
          const res = await fetch(COINBASE_USER_URL, {
            headers: { Authorization: `Bearer ${tokenRes.access_token}` },
          });
          return res.json() as Promise<{ data: { id: string; name: string; avatar_url?: string } }>;
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });

      const sessionId = randomBytes(32).toString('hex');
      const sessionService = yield* SessionService;

      yield* sessionService.create({
        sessionId,
        accessToken: tokenRes.access_token,
        refreshToken: tokenRes.refresh_token,
        expiresAt: Date.now() + tokenRes.expires_in * 1000,
        oauthSubject: userData.data.id,
        displayName: userData.data.name,
        avatarUrl: userData.data.avatar_url,
      });

      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
      return Http.ok({ redirect: `${frontendUrl}/auth/callback?sessionId=${sessionId}` });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )(c);
});

// GET /auth/coinbase/session — validate sessionId and return user
coinbaseAuthGroup.get('/session', (c) =>
  handler((ctx) =>
    Effect.gen(function* () {
      const sessionId = ctx.req.header('X-Session-Id');
      if (!sessionId) {
        return Http.unauthorized();
      }

      const sessionService = yield* SessionService;
      const session = yield* sessionService.getById(sessionId);

      return Http.ok({
        user: {
          id: session.oauthSubject,
          name: session.displayName ?? session.oauthSubject,
        },
      });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )(c)
);

// POST /auth/coinbase/logout
coinbaseAuthGroup.post('/logout', (c) =>
  handler((ctx) =>
    Effect.gen(function* () {
      const sessionId = ctx.req.header('X-Session-Id');
      if (sessionId) {
        const sessionService = yield* SessionService;
        yield* sessionService.delete(sessionId);
      }
      return Http.ok({ ok: true });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )(c)
);

import { randomBytes } from 'crypto';
import { Effect } from 'effect';
import { Hono } from 'hono';
import { AppLayer } from '../../config/layers';
import {
  buildAuthorizeUrl,
  clearTokens,
  exchangeCodeForTokens,
  generatePKCE,
  generateState,
  loadTokens,
  saveTokens,
} from '../../core/providers/codex';
import { getSecret } from '../../core/providers/secret-adapter';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';

const CALLBACK_PORT = 1455;
const CALLBACK_PATH = '/auth/callback';
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

type PendingAuth = {
  verifier: string;
  state: string;
  redirectUri: string;
};

let pending: PendingAuth | null = null;

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('ChatGPT auth error:', error);
  return Http.internalError();
};

// Import Server type dynamically
async function ensureCallbackServer(): Promise<void> {
  // Check if server already exists
  if (pending) return;
  console.log('OAuth callback server would start on port', CALLBACK_PORT);
}

const chatgpt = new Hono()
  .get(
    '/has-auth',
    handler((c) =>
      Effect.gen(function* () {
        const tokens = yield* Effect.tryPromise({
          try: () => loadTokens(),
          catch: () => null,
        });

        if (tokens?.access) {
          return Http.ok({ hasAuth: true, mode: 'oauth', accountId: tokens.accountId });
        }

        const apiKey = yield* Effect.tryPromise({
          try: () => getSecret('openai.apiKey'),
          catch: () => null,
        });

        return Http.ok({ hasAuth: Boolean(apiKey), mode: apiKey ? 'apiKey' : 'none' });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .post(
    '/oauth',
    handler((c) =>
      Effect.gen(function* () {
        const pkce = yield* Effect.tryPromise({
          try: () => generatePKCE(),
          catch: (error) => new Error(String(error)),
        });

        const state = generateState();
        pending = { verifier: pkce.verifier, state, redirectUri: REDIRECT_URI };

        yield* Effect.tryPromise({
          try: () => ensureCallbackServer(),
          catch: (error) => new Error(String(error)),
        });

        const authUrl = buildAuthorizeUrl(REDIRECT_URI, pkce, state);
        return Http.ok({ authUrl, redirectUri: REDIRECT_URI });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .post(
    '/signout',
    handler((c) =>
      Effect.gen(function* () {
        pending = null;
        yield* Effect.tryPromise({
          try: () => clearTokens(),
          catch: (error) => new Error(String(error)),
        });
        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  );

export { chatgpt };
export type ChatGPTRoute = typeof chatgpt;

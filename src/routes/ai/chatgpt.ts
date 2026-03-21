import { type Server, createServer } from 'node:http';
import { Hono } from 'hono';
import {
  buildAuthorizeUrl,
  clearTokens,
  exchangeCodeForTokens,
  generatePKCE,
  generateState,
  loadTokens,
  saveTokens,
} from '../../core/providers/codex';
import { getSecret } from '../../core/stores/secret-store';

const CALLBACK_PORT = 1455;
const CALLBACK_PATH = '/auth/callback';
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

type PendingAuth = {
  verifier: string;
  state: string;
  redirectUri: string;
};

let pending: PendingAuth | null = null;
let callbackServer: Server | null = null;
let callbackServerClosing: Promise<void> | null = null;

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${title}</title></head><body>${body}</body></html>`;
}

async function ensureCallbackServer(): Promise<void> {
  if (callbackServer) return;
  if (callbackServerClosing) await callbackServerClosing;

  callbackServer = createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://localhost');
      if (u.pathname !== CALLBACK_PATH) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      const error = u.searchParams.get('error');
      const code = u.searchParams.get('code');
      const state = u.searchParams.get('state');

      if (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(htmlPage('OAuth Error', `<h1>OAuth Error</h1><p>${error}</p>`));
        return;
      }

      if (!pending) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(htmlPage('OAuth Error', '<h1>No pending auth</h1><p>Restart login from the app.</p>'));
        return;
      }

      if (!code || !state) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(htmlPage('OAuth Error', '<h1>Missing code/state</h1>'));
        return;
      }

      if (state !== pending.state) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(htmlPage('OAuth Error', '<h1>Invalid state</h1><p>Possible CSRF.</p>'));
        return;
      }

      const tokens = await exchangeCodeForTokens(code, pending.redirectUri, pending.verifier);
      await saveTokens(tokens);
      pending = null;

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        htmlPage(
          'Connected',
          '<h1>Connected</h1><p>You can close this window.</p><script>setTimeout(() => window.close(), 1200)</script>'
        )
      );

      const s = callbackServer;
      callbackServer = null;
      callbackServerClosing = new Promise<void>((resolve) => {
        s?.close(() => resolve());
      }).finally(() => {
        callbackServerClosing = null;
      });
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        htmlPage('OAuth Error', `<h1>Internal error</h1><pre>${e instanceof Error ? e.message : String(e)}</pre>`)
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    callbackServer?.once('error', reject);
    callbackServer?.listen(CALLBACK_PORT, '127.0.0.1', () => resolve());
  });
}

const chatgpt = new Hono()
  .get('/has-auth', async (c) => {
    const t = await loadTokens();
    if (t?.access) {
      return c.json({ hasAuth: true, mode: 'oauth', accountId: t.accountId });
    }

    const apiKey = await getSecret('openai.apiKey');
    return c.json({ hasAuth: Boolean(apiKey), mode: apiKey ? 'apiKey' : 'none' });
  })
  .post('/oauth', async (c) => {
    const pkce = await generatePKCE();
    const state = generateState();
    pending = { verifier: pkce.verifier, state, redirectUri: REDIRECT_URI };
    await ensureCallbackServer();
    return c.json({ authUrl: buildAuthorizeUrl(REDIRECT_URI, pkce, state), redirectUri: REDIRECT_URI });
  })
  .post('/signout', async (c) => {
    pending = null;
    await clearTokens();
    return c.json({ ok: true });
  });

export { chatgpt };
export type ChatGPTRoute = typeof chatgpt;

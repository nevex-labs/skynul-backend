import { Hono } from 'hono';

// ChatGPT OAuth state
let chatgptAuthState: { accessToken?: string; refreshToken?: string } = {};

const chatgpt = new Hono()
  .get('/has-auth', (c) => {
    return c.json({ hasAuth: Boolean(chatgptAuthState.accessToken) });
  })
  .post('/oauth', async (c) => {
    // TODO: Implement actual OAuth flow
    // This would open a browser window and handle the callback
    return c.json({ error: 'Not implemented' }, 501);
  })
  .post('/signout', (c) => {
    chatgptAuthState = {};
    return c.json({ ok: true });
  });

export { chatgpt, chatgptAuthState };
export type ChatGPTRoute = typeof chatgpt;

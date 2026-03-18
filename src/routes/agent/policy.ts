import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { loadPolicy, savePolicy } from '../../core/stores/policy-store';
import type { CapabilityId, ProviderId } from '../../types';

let policy = await loadPolicy();

const VALID_PROVIDERS: ProviderId[] = [
  'chatgpt',
  'claude',
  'deepseek',
  'kimi',
  'glm',
  'minimax',
  'openrouter',
  'gemini',
  'ollama',
];

export { policy as policyState };

/** Reload policy from disk (used at server startup). */
export async function refreshPolicy(): Promise<void> {
  policy = await loadPolicy();
}

const policyRoutes = new Hono()
  .get('/', async (c) => {
    return c.json(policy);
  })
  .put(
    '/capability',
    zValidator(
      'json',
      z.object({
        id: z.enum(['fs.read', 'fs.write', 'cmd.run', 'net.http']),
        enabled: z.boolean(),
      })
    ),
    async (c) => {
      const { id, enabled } = c.req.valid('json');
      policy = {
        ...policy,
        capabilities: { ...policy.capabilities, [id]: enabled },
      };
      await savePolicy(policy);
      return c.json(policy);
    }
  )
  .put(
    '/theme',
    zValidator(
      'json',
      z.object({
        themeMode: z.enum(['system', 'light', 'dark']),
      })
    ),
    async (c) => {
      const { themeMode } = c.req.valid('json');
      policy = { ...policy, themeMode };
      await savePolicy(policy);
      return c.json(policy);
    }
  )
  .put(
    '/language',
    zValidator(
      'json',
      z.object({
        language: z.enum(['en', 'es']),
      })
    ),
    async (c) => {
      const { language } = c.req.valid('json');
      policy = { ...policy, language };
      await savePolicy(policy);
      return c.json(policy);
    }
  )
  .put(
    '/provider',
    zValidator(
      'json',
      z.object({
        active: z.string(),
      })
    ),
    async (c) => {
      const { active } = c.req.valid('json');
      if (!VALID_PROVIDERS.includes(active as ProviderId)) {
        return c.json({ error: `Unknown provider: ${active}` }, 400);
      }
      policy = { ...policy, provider: { ...policy.provider, active: active as ProviderId } };
      await savePolicy(policy);
      return c.json(policy);
    }
  )
  .put(
    '/provider/model',
    zValidator(
      'json',
      z.object({
        model: z.string().min(1),
      })
    ),
    async (c) => {
      const { model } = c.req.valid('json');
      policy = { ...policy, provider: { ...policy.provider, openaiModel: model } };
      await savePolicy(policy);
      return c.json(policy);
    }
  )
  .put(
    '/task-memory',
    zValidator(
      'json',
      z.object({
        enabled: z.boolean(),
      })
    ),
    async (c) => {
      const { enabled } = c.req.valid('json');
      policy = { ...policy, taskMemoryEnabled: enabled };
      await savePolicy(policy);
      return c.json(policy);
    }
  )
  .put(
    '/task-auto-approve',
    zValidator(
      'json',
      z.object({
        enabled: z.boolean(),
      })
    ),
    async (c) => {
      const { enabled } = c.req.valid('json');
      policy = { ...policy, taskAutoApprove: enabled };
      await savePolicy(policy);
      return c.json(policy);
    }
  )
  .put(
    '/workspace',
    zValidator(
      'json',
      z.object({
        path: z.string().nullable(),
      })
    ),
    async (c) => {
      const { path } = c.req.valid('json');
      policy = { ...policy, workspaceRoot: path };
      await savePolicy(policy);
      return c.json(policy);
    }
  );

export { policyRoutes as policy };
export type PolicyRoute = typeof policyRoutes;

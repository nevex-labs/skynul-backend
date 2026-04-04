/**
 * Unified AI Providers API.
 *
 * Single source of truth for provider management:
 * - List all providers with connection status
 * - Connect/disconnect providers (API keys or OAuth)
 * - Activate a provider as the current one
 *
 * All secrets are stored via ProviderSecretsService (provider_secrets table),
 * which is what the actual provider clients read from.
 */

import { Effect } from 'effect';
import { Hono } from 'hono';
import { AppLayer } from '../../config/layers';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { ProviderSecretsService } from '../../services/provider-secrets';
import { SettingsService } from '../../services/settings';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Provider operation error:', error);
  return Http.internalError();
};

function getUserId(c: any): number | null {
  return (c.get('jwtPayload') as any)?.userId ?? null;
}

interface ProviderDef {
  id: string;
  name: string;
  description: string;
  secretProvider: string;
  secretKey: string;
  policyKey: string;
  oauth?: boolean;
  models: string[];
}

const PROVIDERS: ProviderDef[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    description: 'Use your ChatGPT Plus/Pro subscription via OAuth',
    secretProvider: 'openai',
    secretKey: 'apiKey',
    policyKey: 'chatgpt',
    oauth: true,
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Direct API access with your own key',
    secretProvider: 'openai',
    secretKey: 'apiKey',
    policyKey: 'chatgpt',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Gemini 2.5 Pro and Flash models',
    secretProvider: 'gemini',
    secretKey: 'apiKey',
    policyKey: 'gemini',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Claude Sonnet and Opus models',
    secretProvider: 'anthropic',
    secretKey: 'apiKey',
    policyKey: 'claude',
    models: ['claude-sonnet-4', 'claude-opus-4'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek Chat and Reasoner models',
    secretProvider: 'deepseek',
    secretKey: 'apiKey',
    policyKey: 'deepseek',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Multi-model access through one key',
    secretProvider: 'openrouter',
    secretKey: 'apiKey',
    policyKey: 'openrouter',
    models: ['various'],
  },
];

const providersGroup = new Hono()
  // GET /api/providers — list all providers with status
  .get(
    '/',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const secrets = yield* ProviderSecretsService;
        const settings = yield* SettingsService;
        const appSettings = yield* settings.getSettings(userId);

        const activeKey = appSettings.activeProvider ?? 'chatgpt';

        const seen = new Set<string>();
        const providers: Array<{
          id: string;
          name: string;
          description: string;
          connected: boolean;
          active: boolean;
          oauth: boolean;
          models: string[];
        }> = [];

        for (const p of PROVIDERS) {
          if (seen.has(p.id)) continue;
          seen.add(p.id);

          const connected = yield* secrets
            .hasSecret(p.secretProvider, p.secretKey)
            .pipe(Effect.catchAll(() => Effect.succeed(false)));

          providers.push({
            id: p.id,
            name: p.name,
            description: p.description,
            connected,
            active: activeKey === p.policyKey,
            oauth: p.oauth ?? false,
            models: p.models,
          });
        }

        return Http.ok({ providers });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )

  // PUT /api/providers/:id/connect — connect a provider
  .put(
    '/:id/connect',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const id = c.req.param('id') as string;
        const def = PROVIDERS.find((p) => p.id === id);
        if (!def) return Http.notFound(`Provider "${id}"`);

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        if (!def.oauth && (!body?.apiKey || typeof body.apiKey !== 'string')) {
          return Http.badRequest('apiKey is required');
        }

        const secrets = yield* ProviderSecretsService;
        const appSettings = yield* SettingsService;

        if (def.oauth) {
          const exists = yield* secrets
            .hasSecret(def.secretProvider, def.secretKey)
            .pipe(Effect.catchAll(() => Effect.succeed(false)));
          if (!exists) {
            return Http.badRequest('OAuth not completed. Sign in first.');
          }
        } else {
          yield* secrets.setSecret(def.secretProvider, def.secretKey, body.apiKey);
        }

        // Always activate the connected provider
        yield* appSettings.updateProvider(userId, def.policyKey);

        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )

  // DELETE /api/providers/:id — disconnect a provider
  .delete(
    '/:id',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const id = c.req.param('id') as string;
        const def = PROVIDERS.find((p) => p.id === id);
        if (!def) return Http.notFound(`Provider "${id}"`);

        const secrets = yield* ProviderSecretsService;
        const appSettings = yield* SettingsService;

        // Delete the secret (ignore if doesn't exist)
        yield* secrets
          .deleteSecret(def.secretProvider, def.secretKey)
          .pipe(Effect.catchAll(() => Effect.succeed(undefined)));

        // If this was the active provider, switch to first available
        const settings = yield* appSettings.getSettings(userId);
        if (settings.activeProvider === def.policyKey) {
          for (const p of PROVIDERS) {
            const connected = yield* secrets
              .hasSecret(p.secretProvider, p.secretKey)
              .pipe(Effect.catchAll(() => Effect.succeed(false)));
            if (connected) {
              yield* appSettings.updateProvider(userId, p.policyKey);
              break;
            }
          }
        }

        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )

  // PUT /api/providers/:id/activate — set as active provider
  .put(
    '/:id/activate',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const id = c.req.param('id') as string;
        const def = PROVIDERS.find((p) => p.id === id);
        if (!def) return Http.notFound(`Provider "${id}"`);

        const secrets = yield* ProviderSecretsService;
        const appSettings = yield* SettingsService;

        // Verify the provider is connected
        const exists = yield* secrets
          .hasSecret(def.secretProvider, def.secretKey)
          .pipe(Effect.catchAll(() => Effect.succeed(false)));
        if (!exists) {
          return Http.badRequest(`Provider "${def.name}" is not connected.`);
        }

        yield* appSettings.updateProvider(userId, def.policyKey);
        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  );

export { providersGroup };
export type ProvidersGroup = typeof providersGroup;

import { Effect } from 'effect';
import { Hono } from 'hono';
import { z } from 'zod';
import { AppLayer } from '../../config/layers';
import { CAPABILITY_GROUPS, MODE_CAPABILITIES } from '../../core/agent/mode-capabilities';
import type { TaskMode } from '../../core/agent/mode-capabilities';
import type { AppSetting, TradingSetting } from '../../infrastructure/db/schema';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { SettingsService } from '../../services/settings';
import type { ProviderId } from '../../shared/types';
import { ALL_TASK_CAPABILITIES, type TaskCapabilityId } from '../../shared/types/task';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Policy error:', error);
  return Http.internalError();
};

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

// Validation schemas
const themeSchema = z.object({
  themeMode: z.enum(['system', 'light', 'dark']),
});

const languageSchema = z.object({
  language: z.enum(['en', 'es']),
});

const providerSchema = z.object({
  active: z.string(),
});

const modelSchema = z.object({
  model: z.string().min(1),
});

const enabledSchema = z.object({
  enabled: z.boolean(),
});

function toPolicyFormat(settings: AppSetting, trading: TradingSetting) {
  return {
    capabilities: {
      'fs.read': true,
      'fs.write': true,
      'cmd.run': true,
      'net.http': true,
    },
    themeMode: settings.themeMode,
    language: settings.language,
    provider: {
      active: settings.activeProvider as ProviderId,
      openaiModel: settings.openaiModel,
    },
    taskMemoryEnabled: settings.taskMemoryEnabled,
    taskAutoApprove: settings.taskAutoApprove,
    paperTradingEnabled: trading.paperTrading,
  };
}

const policyRoutes = new Hono()
  .get(
    '/',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) {
          return Http.unauthorized();
        }

        const service = yield* SettingsService;
        const settings = yield* service.getSettings(userId);
        const trading = yield* service.getTradingSettings(userId);
        return Http.ok(toPolicyFormat(settings, trading));
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/theme',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) {
          return Http.unauthorized();
        }

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = themeSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* SettingsService;
        const updated = yield* service.updateTheme(userId, parsed.data.themeMode);
        const trading = yield* service.getTradingSettings(userId);
        return Http.ok(toPolicyFormat(updated, trading));
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/language',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) {
          return Http.unauthorized();
        }

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = languageSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* SettingsService;
        const updated = yield* service.updateLanguage(userId, parsed.data.language);
        const trading = yield* service.getTradingSettings(userId);
        return Http.ok(toPolicyFormat(updated, trading));
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/provider',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) {
          return Http.unauthorized();
        }

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = providerSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        if (!VALID_PROVIDERS.includes(parsed.data.active as ProviderId)) {
          return Http.badRequest(`Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`);
        }

        const service = yield* SettingsService;
        const updated = yield* service.updateProvider(userId, parsed.data.active);
        const trading = yield* service.getTradingSettings(userId);
        return Http.ok(toPolicyFormat(updated, trading));
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/provider/model',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) {
          return Http.unauthorized();
        }

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = modelSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* SettingsService;
        const updated = yield* service.updateProviderModel(userId, parsed.data.model);
        const trading = yield* service.getTradingSettings(userId);
        return Http.ok(toPolicyFormat(updated, trading));
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/task-memory',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) {
          return Http.unauthorized();
        }

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = enabledSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* SettingsService;
        const updated = yield* service.updateTaskMemory(userId, parsed.data.enabled);
        const trading = yield* service.getTradingSettings(userId);
        return Http.ok(toPolicyFormat(updated, trading));
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/task-auto-approve',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) {
          return Http.unauthorized();
        }

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = enabledSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* SettingsService;
        const updated = yield* service.updateTaskAutoApprove(userId, parsed.data.enabled);
        const trading = yield* service.getTradingSettings(userId);
        return Http.ok(toPolicyFormat(updated, trading));
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/paper-trading',
    handler((c) =>
      Effect.gen(function* () {
        const userId = (c.get('jwtPayload') as any)?.userId as number | undefined;
        if (!userId) {
          return Http.unauthorized();
        }

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = enabledSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* SettingsService;
        const tradingUpdated = yield* service.updatePaperTrading(userId, parsed.data.enabled);
        const settings = yield* service.getSettings(userId);
        return Http.ok(toPolicyFormat(settings, tradingUpdated));
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  );

export { policyRoutes as policy };
export type PolicyRoutes = typeof policyRoutes;

// ── Capabilities endpoint ─────────────────────────────────────────────────────

const capabilitiesRoute = new Hono().get(
  '/',
  handler(() =>
    Effect.succeed(
      Http.ok({
        groups: CAPABILITY_GROUPS,
        modeDefaults: MODE_CAPABILITIES,
      })
    )
  )
);

export { capabilitiesRoute as capabilities };
export type CapabilitiesRoute = typeof capabilitiesRoute;

import { Effect } from 'effect';
import { Hono } from 'hono';
import { z } from 'zod';
import { AppLayer } from '../../config/layers';
import type { AppSetting } from '../../infrastructure/db/schema';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { SettingsService } from '../../services/settings';
import type { ProviderId } from '../../types';

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
const capabilitySchema = z.object({
  id: z.enum(['fs.read', 'fs.write', 'cmd.run', 'net.http']),
  enabled: z.boolean(),
});

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

const workspaceSchema = z.object({
  path: z.string().nullable(),
});

// Convert DB settings to legacy policy format for backward compatibility
function toPolicyFormat(settings: AppSetting) {
  return {
    workspaceRoot: settings.workspaceRoot,
    capabilities: {
      'fs.read': settings.capabilityFsRead,
      'fs.write': settings.capabilityFsWrite,
      'cmd.run': settings.capabilityCmdRun,
      'net.http': settings.capabilityNetHttp,
    },
    themeMode: settings.themeMode,
    language: settings.language,
    provider: {
      active: settings.activeProvider as ProviderId,
      openaiModel: settings.openaiModel,
    },
    taskMemoryEnabled: settings.taskMemoryEnabled,
    taskAutoApprove: settings.taskAutoApprove,
    paperTradingEnabled: settings.paperTradingEnabled,
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
        return Http.ok(toPolicyFormat(settings));
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/capability',
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

        const parsed = capabilitySchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* SettingsService;
        const updated = yield* service.updateCapability(userId, parsed.data.id, parsed.data.enabled);
        return Http.ok(toPolicyFormat(updated));
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
        return Http.ok(toPolicyFormat(updated));
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
        return Http.ok(toPolicyFormat(updated));
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
          return Http.badRequest(`Unknown provider: ${parsed.data.active}`);
        }

        const service = yield* SettingsService;
        const updated = yield* service.updateProvider(userId, parsed.data.active);
        return Http.ok(toPolicyFormat(updated));
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
        return Http.ok(toPolicyFormat(updated));
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
        return Http.ok(toPolicyFormat(updated));
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
        return Http.ok(toPolicyFormat(updated));
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
        const updated = yield* service.updatePaperTrading(userId, parsed.data.enabled);
        return Http.ok(toPolicyFormat(updated));
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/workspace',
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

        const parsed = workspaceSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* SettingsService;
        const updated = yield* service.updateWorkspace(userId, parsed.data.path);
        return Http.ok(toPolicyFormat(updated));
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  );

export { policyRoutes as policy };
export type PolicyRoute = typeof policyRoutes;

import { Effect } from 'effect';
import { Hono } from 'hono';
import { z } from 'zod';
import { AppLayer } from '../../config/layers';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { ChannelService } from '../../services/channels/tag';
import { ChannelNotFoundError } from '../../shared/errors';
import type { ChannelId } from '../../types';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Channel error:', error);
  if (error?._tag === 'ChannelNotFoundError') {
    return Http.notFound(`Channel ${error.channelId}`);
  }
  if (error instanceof Error) {
    return Http.badRequest(error.message);
  }
  return Http.internalError();
};

const VALID_CHANNELS: ChannelId[] = ['telegram', 'whatsapp', 'discord', 'signal', 'slack'];

export const channelManager = {
  async loadGlobal() {},
  async startAll() {
    console.log('[channelManager] startAll called - channels managed via DB');
  },
  async stopAll() {
    console.log('[channelManager] stopAll called');
  },
  getGlobalSettings() {
    return { autoApprove: true };
  },
  isAutoApprove() {
    return true;
  },
};

const enabledSchema = z.object({ enabled: z.boolean() });
const credentialsSchema = z.record(z.string());

const channels = new Hono()
  .get(
    '/',
    handler((c) =>
      Effect.gen(function* () {
        const service = yield* ChannelService;
        const allSettings = yield* service.getAllSettings();

        const channelList = allSettings.map((s) => ({
          id: s.channelId,
          enabled: s.enabled,
          status: s.status,
          paired: s.paired,
          pairingCode: s.pairingCode,
          error: s.error,
          hasCredentials: s.hasCredentials,
          meta: s.meta || {},
        }));

        return Http.ok({ channels: channelList });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .get(
    '/global',
    handler((c) =>
      Effect.gen(function* () {
        const service = yield* ChannelService;
        const global = yield* service.getGlobalSettings();
        return Http.ok({ autoApprove: global.autoApprove });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/:id/enabled',
    handler((c) =>
      Effect.gen(function* () {
        const id = c.req.param('id') as ChannelId;
        if (!VALID_CHANNELS.includes(id)) {
          return Http.badRequest(`Unknown channel: ${id}`);
        }

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = enabledSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* ChannelService;
        const settings = yield* service.setChannelEnabled(id, parsed.data.enabled);

        return Http.ok({
          id: settings.channelId,
          enabled: settings.enabled,
          status: settings.status,
          paired: settings.paired,
          pairingCode: settings.pairingCode,
          error: settings.error,
          hasCredentials: settings.hasCredentials,
          meta: settings.meta || {},
        });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/:id/credentials',
    handler((c) =>
      Effect.gen(function* () {
        const id = c.req.param('id') as ChannelId;
        if (!VALID_CHANNELS.includes(id)) {
          return Http.badRequest(`Unknown channel: ${id}`);
        }

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = credentialsSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* ChannelService;
        yield* service.setChannelCredentials(id, parsed.data);
        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .post(
    '/:id/pairing',
    handler((c) =>
      Effect.gen(function* () {
        const id = c.req.param('id') as ChannelId;
        if (!VALID_CHANNELS.includes(id)) {
          return Http.badRequest(`Unknown channel: ${id}`);
        }

        const service = yield* ChannelService;
        const code = yield* service.generatePairingCode(id);
        return Http.ok({ code });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .delete(
    '/:id/pairing',
    handler((c) =>
      Effect.gen(function* () {
        const id = c.req.param('id') as ChannelId;
        if (!VALID_CHANNELS.includes(id)) {
          return Http.badRequest(`Unknown channel: ${id}`);
        }

        const service = yield* ChannelService;
        yield* service.unpairChannel(id);
        return Http.ok({ ok: true });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/auto-approve',
    handler((c) =>
      Effect.gen(function* () {
        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = enabledSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* ChannelService;
        const settings = yield* service.setAutoApprove(parsed.data.enabled);
        return Http.ok({ autoApprove: settings.autoApprove });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  );

export { channels };
export type ChannelsRoute = typeof channels;

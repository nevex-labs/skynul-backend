import { Effect } from 'effect';
import { Hono } from 'hono';
import { z } from 'zod';
import { AppLayer } from '../../config/layers';
import { dispatchChat } from '../../core/providers/dispatch';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { SettingsService } from '../../services/settings';
import type { ProviderId } from '../../shared/types';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Chat error:', error);

  if (error instanceof Error) {
    return Http.badRequest(error.message);
  }

  return Http.internalError();
};

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
});

const chat = new Hono().post(
  '/send',
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

      const parsed = chatRequestSchema.safeParse(body);
      if (!parsed.success) {
        return Http.badRequest(parsed.error.message);
      }

      const settingsService = yield* SettingsService;
      const settings = yield* settingsService.getSettings(userId);

      const content = yield* Effect.tryPromise({
        try: () => dispatchChat(settings.activeProvider as ProviderId, parsed.data.messages),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });

      return Http.ok({ content });
    }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
  )
);

export { chat };
export type ChatRoute = typeof chat;

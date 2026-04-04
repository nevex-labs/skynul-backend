import { Effect } from 'effect';
import { readFile } from 'fs/promises';
import { Hono } from 'hono';
import { z } from 'zod';
import { AppLayer } from '../../config/layers';
import { Http, createEffectRoute } from '../../lib/hono-effect';
import type { HttpResponse } from '../../lib/hono-effect';
import { SkillService } from '../../services/skills/tag';
import { SkillNotFoundError } from '../../shared/errors';

const handler = createEffectRoute(AppLayer as any);

const handleError = (error: any): HttpResponse => {
  console.error('Skill operation error:', error);
  if (error?._tag === 'SkillNotFoundError') {
    return Http.notFound(`Skill ${error.skillId}`);
  }
  return Http.internalError();
};

function getUserId(c: any): number | null {
  return (c.get('jwtPayload') as any)?.userId ?? null;
}

const skillSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1),
  tag: z.string().min(1),
  description: z.string(),
  prompt: z.string(),
  enabled: z.boolean().optional().default(true),
});

const importSchema = z.object({
  filePath: z.string(),
});

const skillsRoute = new Hono()
  .get(
    '/',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const service = yield* SkillService;
        const list = yield* service.list(userId);
        return Http.ok({ skills: list });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .post(
    '/',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = skillSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* SkillService;

        if (parsed.data.id) {
          yield* service.update(userId, parsed.data.id, {
            name: parsed.data.name,
            tag: parsed.data.tag,
            description: parsed.data.description,
            prompt: parsed.data.prompt,
            enabled: parsed.data.enabled,
          });
        } else {
          yield* service.create(userId, {
            name: parsed.data.name,
            tag: parsed.data.tag,
            description: parsed.data.description,
            prompt: parsed.data.prompt,
            enabled: parsed.data.enabled,
          });
        }

        const all = yield* service.list(userId);
        return Http.ok({ skills: all });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .delete(
    '/:id',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const id = Number.parseInt(c.req.param('id') || '', 10);
        if (isNaN(id)) {
          return Http.badRequest('Invalid skill ID');
        }

        const service = yield* SkillService;
        yield* service.delete(userId, id);
        const all = yield* service.list(userId);
        return Http.ok({ skills: all });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .put(
    '/:id/toggle',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const id = Number.parseInt(c.req.param('id') || '', 10);
        if (isNaN(id)) {
          return Http.badRequest('Invalid skill ID');
        }

        const service = yield* SkillService;
        yield* service.toggle(userId, id);
        const all = yield* service.list(userId);
        return Http.ok({ skills: all });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  )
  .post(
    '/import',
    handler((c) =>
      Effect.gen(function* () {
        const userId = getUserId(c);
        if (!userId) return Http.unauthorized();

        const body = yield* Effect.tryPromise({
          try: () => c.req.json(),
          catch: () => null,
        });

        const parsed = importSchema.safeParse(body);
        if (!parsed.success) {
          return Http.badRequest(parsed.error.message);
        }

        const service = yield* SkillService;

        const raw = yield* Effect.tryPromise({
          try: () => readFile(parsed.data.filePath, 'utf8'),
          catch: (error) => new Error(`Failed to read file: ${error}`),
        });

        const filePath = parsed.data.filePath;
        const isMarkdown = filePath.endsWith('.md') || filePath.endsWith('.markdown');
        const basename = filePath.split(/[\\/]/).pop() ?? 'Imported';
        const nameFromFile = basename.replace(/\.(json|md|markdown)$/i, '');

        let name = nameFromFile;
        let tag = '';
        let description = '';
        let prompt = raw;

        if (isMarkdown) {
          const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
          if (fmMatch) {
            const frontmatter = fmMatch[1];
            prompt = fmMatch[2].trim();
            for (const line of frontmatter.split('\n')) {
              const [key, ...rest] = line.split(':');
              const val = rest.join(':').trim();
              if (key.trim() === 'name') name = val;
              else if (key.trim() === 'tag' || key.trim() === 'category') tag = val;
              else if (key.trim() === 'description') description = val;
            }
          }
        } else {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          name = String(parsed.name ?? nameFromFile);
          tag = String(parsed.tag ?? parsed.category ?? '');
          description = String(parsed.description ?? '');
          prompt = String(parsed.prompt ?? '');
        }

        const all = yield* service.import(userId, {
          name,
          tag,
          description,
          prompt,
          enabled: true,
        });

        return Http.ok({ skills: all });
      }).pipe(Effect.catchAll((error) => Effect.succeed(handleError(error))))
    )
  );

export { skillsRoute as skills };
export type SkillsRoute = typeof skillsRoute;

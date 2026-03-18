import { zValidator } from '@hono/zod-validator';
import { readFile } from 'fs/promises';
import { Hono } from 'hono';
import { z } from 'zod';
import { createSkillId, loadSkills, saveSkills } from '../core/stores/skill-store';
import type { Skill } from '../types';

const skillSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  tag: z.string().min(1),
  description: z.string(),
  prompt: z.string(),
  enabled: z.boolean().optional().default(true),
});

const skills = new Hono()
  .get('/', async (c) => {
    return c.json({ skills: await loadSkills() });
  })
  .post('/', zValidator('json', skillSchema), async (c) => {
    const body = c.req.valid('json');
    const all = await loadSkills();

    if (body.id) {
      const idx = all.findIndex((s) => s.id === body.id);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...body } as Skill;
      }
    } else {
      all.push({ ...body, id: createSkillId(), createdAt: Date.now() } as Skill);
    }

    await saveSkills(all);
    return c.json({ skills: all });
  })
  .delete('/:id', async (c) => {
    const id = c.req.param('id');
    const all = (await loadSkills()).filter((s) => s.id !== id);
    await saveSkills(all);
    return c.json({ skills: all });
  })
  .put('/:id/toggle', async (c) => {
    const id = c.req.param('id');
    const all = await loadSkills();
    const s = all.find((sk) => sk.id === id);
    if (s) s.enabled = !s.enabled;
    await saveSkills(all);
    return c.json({ skills: all });
  })
  .post(
    '/import',
    zValidator(
      'json',
      z.object({
        filePath: z.string(),
      })
    ),
    async (c) => {
      const { filePath } = c.req.valid('json');
      const raw = await readFile(filePath, 'utf8');
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

      const all = await loadSkills();
      all.push({
        id: createSkillId(),
        name,
        tag,
        description,
        prompt,
        enabled: true,
        createdAt: Date.now(),
      });
      await saveSkills(all);
      return c.json({ skills: all });
    }
  );

export { skills };
export type SkillsRoute = typeof skills;

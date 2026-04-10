import { Hono } from 'hono';
import { createSkillFromInput, listAllSkills, removeSkill } from '../../services/skills';

const skills = new Hono();

skills.get('/', async (c) => {
  const all = await listAllSkills();
  return c.json({ skills: all });
});

skills.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }
  if (typeof body.content !== 'string' && typeof body.prompt !== 'string') {
    return c.json({ error: 'content or prompt is required' }, 400);
  }
  const skill = await createSkillFromInput(body);
  return c.json({ skill }, 201);
});

skills.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await removeSkill(id);
  return c.json({ success: true });
});

export default skills;

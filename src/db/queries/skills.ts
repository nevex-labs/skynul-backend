import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import type { Skill } from '../../types';
import { db } from '../index';
import type { NewSkill } from '../schema/skills';
import { skillsTable } from '../schema/skills';
import { getSystemUserId } from './users';

export async function createSkill(input: NewSkill) {
  const [skill] = await db.insert(skillsTable).values(input).returning();
  return skill;
}

export async function getSkillById(id: string) {
  const [skill] = await db.select().from(skillsTable).where(eq(skillsTable.id, id));
  return skill;
}

export async function getSkillsByUser(userId: string) {
  return db.select().from(skillsTable).where(eq(skillsTable.userId, userId));
}

export async function updateSkill(id: string, data: { name?: string; content?: string }) {
  const [skill] = await db.update(skillsTable).set(data).where(eq(skillsTable.id, id)).returning();
  return skill;
}

export async function deleteSkill(id: string) {
  await db.delete(skillsTable).where(eq(skillsTable.id, id));
}

function encodeSkillContent(s: Pick<Skill, 'prompt' | 'tag' | 'description' | 'enabled' | 'createdAt'>): string {
  return JSON.stringify({
    prompt: s.prompt,
    tag: s.tag,
    description: s.description,
    enabled: s.enabled,
    createdAt: s.createdAt,
  });
}

function rowToSkill(row: { id: string; name: string; content: string; createdAt: Date }): Skill {
  try {
    const m = JSON.parse(row.content) as Partial<Skill>;
    if (m && typeof m.prompt === 'string') {
      return {
        id: row.id,
        name: row.name,
        tag: String(m.tag ?? ''),
        description: String(m.description ?? ''),
        prompt: m.prompt,
        enabled: Boolean(m.enabled ?? true),
        createdAt: typeof m.createdAt === 'number' ? m.createdAt : row.createdAt.getTime(),
      };
    }
  } catch {
    /* plain text */
  }
  return {
    id: row.id,
    name: row.name,
    tag: '',
    description: '',
    prompt: row.content,
    enabled: true,
    createdAt: row.createdAt.getTime(),
  };
}

export async function listSkills(): Promise<Skill[]> {
  const uid = await getSystemUserId();
  const rows = await getSkillsByUser(uid);
  return rows.map(rowToSkill);
}

export function newSkillId(): string {
  return randomUUID();
}

export async function insertUserSkill(skill: Skill): Promise<void> {
  const uid = await getSystemUserId();
  await createSkill({
    id: skill.id,
    userId: uid,
    name: skill.name,
    content: encodeSkillContent(skill),
  });
}

export async function patchUserSkill(
  id: string,
  partial: Partial<Pick<Skill, 'name' | 'prompt' | 'tag' | 'description' | 'enabled'>>
): Promise<void> {
  const uid = await getSystemUserId();
  const rows = await getSkillsByUser(uid);
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  const cur = rowToSkill(row);
  const next: Skill = {
    ...cur,
    ...partial,
    name: partial.name ?? cur.name,
    prompt: partial.prompt ?? cur.prompt,
    tag: partial.tag ?? cur.tag,
    description: partial.description ?? cur.description,
    enabled: partial.enabled ?? cur.enabled,
  };
  await updateSkill(id, { name: next.name, content: encodeSkillContent(next) });
}

export async function getUserSkillById(id: string): Promise<Skill | null> {
  const uid = await getSystemUserId();
  const row = await getSkillById(id);
  if (!row || row.userId !== uid) return null;
  return rowToSkill(row);
}

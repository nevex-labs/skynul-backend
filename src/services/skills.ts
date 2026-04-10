import { deleteSkill, insertUserSkill, listSkills, newSkillId } from '../db/queries/skills';
import type { Skill } from '../types';

type CreateSkillInput = {
  name: string;
  content?: string;
  prompt?: string;
  trigger?: string;
  enabled?: boolean;
};

export async function listAllSkills() {
  return listSkills();
}

export async function createSkillFromInput(input: CreateSkillInput) {
  const now = Date.now();
  const skill: Skill = {
    id: newSkillId(),
    name: input.name,
    tag: input.trigger ?? '',
    description: '',
    prompt: input.content ?? input.prompt ?? '',
    enabled: input.enabled ?? true,
    createdAt: now,
  };
  await insertUserSkill(skill);
  return skill;
}

export async function removeSkill(id: string): Promise<void> {
  await deleteSkill(id);
}

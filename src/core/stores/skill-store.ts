import { randomBytes } from 'crypto';
import { dirname, join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import type { Skill } from '../../types';
import { getDataDir } from '../config';
import { SkillArraySchema } from './schemas';

function filePath(): string {
  return join(getDataDir(), 'skills.json');
}

export async function loadSkills(): Promise<Skill[]> {
  try {
    const raw = await readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw);
    const result = SkillArraySchema.safeParse(parsed);
    if (result.success) return result.data;
    console.warn('[skill-store] Invalid data:', result.error.issues);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveSkills(skills: Skill[]): Promise<void> {
  const f = filePath();
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(skills, null, 2), 'utf8');
}

export function createSkillId(): string {
  return `skill_${randomBytes(4).toString('hex')}`;
}

// Synonyms so skills match regardless of prompt language
const SKILL_SYNONYMS: Record<string, string[]> = {
  design: ['diseño', 'diseñ', 'diseña', 'diseñes', 'diseñar'],
  logo: ['logotipo', 'isotipo', 'marca', 'brand', 'branding'],
  graphic: ['gráfico', 'grafico', 'gráfica', 'grafica', 'visual'],
  vector: ['vectorial', 'vectores', 'svg'],
  illustrator: ['illustrator'],
  photoshop: ['photoshop'],
  blender: ['blender', '3d', 'render'],
  icon: ['icono', 'iconos', 'icons'],
};

export function getActiveSkillPrompts(skills: Skill[], taskPrompt: string): string {
  const active = skills.filter((s) => s.enabled);
  if (active.length === 0) return '';

  const prompt = taskPrompt.toLowerCase();
  const relevant = active.filter((s) => {
    const words = `${s.tag} ${s.name} ${s.description}`.toLowerCase().split(/\s+/);
    return words.some((w) => {
      if (w.length <= 2) return false;
      if (prompt.includes(w)) return true;
      const syns = SKILL_SYNONYMS[w];
      if (syns) return syns.some((syn) => prompt.includes(syn));
      return false;
    });
  });

  if (relevant.length === 0) return '';
  const lines = relevant.map((s) => `[${s.tag}/${s.name}]: ${s.prompt}`);
  return `\n## Active Skills:\n${lines.join('\n')}\n`;
}

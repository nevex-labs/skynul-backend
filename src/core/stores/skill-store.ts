// Stub for backward compatibility
// Skills are now managed via SkillService (Effect + PostgreSQL)

export async function loadSkills() {
  return [];
}

export function getActiveSkillPrompts(_skills: any[], _taskPrompt: string) {
  return '';
}

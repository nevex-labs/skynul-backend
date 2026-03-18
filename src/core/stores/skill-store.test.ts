import { describe, it, expect } from 'vitest';
import { getActiveSkillPrompts } from './skill-store';
import type { Skill } from '../../types';

describe('getActiveSkillPrompts', () => {
  const mockSkills: Skill[] = [
    {
      id: '1',
      name: 'Logo Design',
      tag: 'design',
      description: 'Creates professional logos',
      prompt: 'You are a logo designer. Create SVG logos.',
      enabled: true,
      createdAt: 0,
    },
    {
      id: '2',
      name: 'Python Coder',
      tag: 'code',
      description: 'Python expert',
      prompt: 'You write Python code.',
      enabled: true,
      createdAt: 0,
    },
    {
      id: '3',
      name: 'Disabled Skill',
      tag: 'test',
      description: 'Should not appear',
      prompt: 'Should not appear in results',
      enabled: false,
      createdAt: 0,
    },
  ];

  it('returns empty string when no skills', () => {
    expect(getActiveSkillPrompts([], 'design a logo')).toBe('');
  });

  it('returns empty string when no enabled skills', () => {
    const disabled: Skill[] = [{ ...mockSkills[2]!, enabled: false }];
    expect(getActiveSkillPrompts(disabled, 'do something')).toBe('');
  });

  it('matches skill by tag', () => {
    const result = getActiveSkillPrompts(mockSkills, 'I need a logo for my brand');
    expect(result).toContain('[design/Logo Design]');
  });

  it('matches skill by name', () => {
    const result = getActiveSkillPrompts(mockSkills, 'design a python script');
    expect(result).toContain('[design/Logo Design]');
  });

  it('matches skill by description', () => {
    const result = getActiveSkillPrompts(mockSkills, 'professional logos for business');
    expect(result).toContain('[design/Logo Design]');
  });

  it('excludes disabled skills', () => {
    const result = getActiveSkillPrompts(mockSkills, 'test skill disabled');
    expect(result).not.toContain('Disabled Skill');
  });

  it('returns empty when no keyword match', () => {
    const result = getActiveSkillPrompts(mockSkills, 'random unrelated task');
    expect(result).toBe('');
  });

  it('matches Spanish synonym diseño', () => {
    const result = getActiveSkillPrompts(mockSkills, 'necesito un diseño de logo');
    expect(result).toContain('[design/Logo Design]');
  });

  it('matches SVG synonym', () => {
    const result = getActiveSkillPrompts(mockSkills, 'create an SVG logo');
    expect(result).toContain('[design/Logo Design]');
  });

  it('ignores words with 2 chars or less', () => {
    const result = getActiveSkillPrompts(mockSkills, 'I need to do it');
    expect(result).toBe('');
  });

  it('matches multiple skills', () => {
    const result = getActiveSkillPrompts(mockSkills, 'logo design and python coding');
    expect(result).toContain('[design/Logo Design]');
    expect(result).toContain('[code/Python Coder]');
  });

  it('formats skill correctly', () => {
    const result = getActiveSkillPrompts([mockSkills[0]!], 'logo');
    expect(result).toMatch(/## Active Skills:\n\[design\/Logo Design\]:/);
  });
});

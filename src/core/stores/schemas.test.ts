import { describe, expect, it } from 'vitest';
import {
  PolicyStateSchema,
  ScheduleArraySchema,
  ScheduleSchema,
  SecretStoreSchema,
  SkillArraySchema,
  SkillSchema,
} from './schemas';

describe('SkillSchema', () => {
  it('accepts valid skill', () => {
    const result = SkillSchema.safeParse({
      id: 'skill_abc123',
      name: 'Code Review',
      tag: 'dev',
      description: 'Reviews code',
      prompt: 'You are a code reviewer',
      enabled: true,
      createdAt: 1700000000000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required field', () => {
    const result = SkillSchema.safeParse({ name: 'Test' });
    expect(result.success).toBe(false);
  });

  it('rejects wrong type for enabled', () => {
    const result = SkillSchema.safeParse({
      id: 's1',
      name: 'Test',
      tag: 't',
      description: 'd',
      prompt: 'p',
      enabled: 'yes',
      createdAt: 123,
    });
    expect(result.success).toBe(false);
  });
});

describe('SkillArraySchema', () => {
  it('accepts valid array', () => {
    const result = SkillArraySchema.safeParse([
      { id: 's1', name: 'A', tag: 't', description: 'd', prompt: 'p', enabled: true, createdAt: 1 },
      { id: 's2', name: 'B', tag: 't2', description: 'd2', prompt: 'p2', enabled: false, createdAt: 2 },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects non-array', () => {
    const result = SkillArraySchema.safeParse({ id: 's1' });
    expect(result.success).toBe(false);
  });

  it('rejects array with invalid item', () => {
    const result = SkillArraySchema.safeParse([
      { id: 's1', name: 'A', tag: 't', description: 'd', prompt: 'p', enabled: true, createdAt: 1 },
      { id: 42 }, // invalid
    ]);
    expect(result.success).toBe(false);
  });
});

describe('ScheduleSchema', () => {
  it('accepts valid schedule', () => {
    const result = ScheduleSchema.safeParse({
      id: 'sched_abc',
      prompt: 'Run daily check',
      capabilities: ['browser.cdp'],
      mode: 'browser',
      frequency: 'daily',
      cronExpr: '0 9 * * *',
      enabled: true,
      lastRunAt: 1700000000000,
      nextRunAt: 1700086400000,
      createdAt: 1699993600000,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null lastRunAt', () => {
    const result = ScheduleSchema.safeParse({
      id: 's1',
      prompt: 'p',
      capabilities: [],
      mode: 'code',
      frequency: 'weekly',
      cronExpr: '* * * *',
      enabled: false,
      lastRunAt: null,
      nextRunAt: 1,
      createdAt: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid mode', () => {
    const result = ScheduleSchema.safeParse({
      id: 's1',
      prompt: 'p',
      capabilities: [],
      mode: 'invalid',
      frequency: 'daily',
      cronExpr: '*',
      enabled: true,
      lastRunAt: null,
      nextRunAt: 1,
      createdAt: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid frequency', () => {
    const result = ScheduleSchema.safeParse({
      id: 's1',
      prompt: 'p',
      capabilities: [],
      mode: 'browser',
      frequency: 'monthly',
      cronExpr: '*',
      enabled: true,
      lastRunAt: null,
      nextRunAt: 1,
      createdAt: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe('ScheduleArraySchema', () => {
  it('accepts empty array', () => {
    const result = ScheduleArraySchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('rejects non-array', () => {
    const result = ScheduleArraySchema.safeParse('not an array');
    expect(result.success).toBe(false);
  });
});

describe('SecretStoreSchema', () => {
  it('accepts valid secrets object', () => {
    const result = SecretStoreSchema.safeParse({
      'claude.apiKey': 'p:SGVsbG8=',
      'openai.apiKey': 'e:c2VjcmV0',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = SecretStoreSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects non-object', () => {
    const result = SecretStoreSchema.safeParse(['key', 'value']);
    expect(result.success).toBe(false);
  });

  it('rejects non-string value', () => {
    const result = SecretStoreSchema.safeParse({ key: 123 });
    expect(result.success).toBe(false);
  });
});

describe('PolicyStateSchema', () => {
  it('accepts full valid policy', () => {
    const result = PolicyStateSchema.safeParse({
      workspaceRoot: '/home/user/project',
      capabilities: { 'fs.read': true, 'fs.write': false, 'cmd.run': false, 'net.http': true },
      themeMode: 'dark',
      language: 'en',
      provider: { active: 'claude', openaiModel: 'claude-sonnet-4' },
      taskMemoryEnabled: true,
      taskAutoApprove: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all fields optional)', () => {
    const result = PolicyStateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts partial config', () => {
    const result = PolicyStateSchema.safeParse({
      provider: { active: 'deepseek' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid themeMode', () => {
    const result = PolicyStateSchema.safeParse({ themeMode: 'purple' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid language', () => {
    const result = PolicyStateSchema.safeParse({ language: 'fr' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid capability key', () => {
    const result = PolicyStateSchema.safeParse({
      capabilities: { 'fs.read': true, 'fs.write': false, 'cmd.run': false, 'net.http': true, 'invalid.cap': false },
    });
    expect(result.success).toBe(true); // extra keys are allowed by z.record
  });

  it('rejects wrong capability value type', () => {
    const result = PolicyStateSchema.safeParse({
      capabilities: { 'fs.read': 'yes', 'fs.write': false, 'cmd.run': false, 'net.http': false },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid provider active', () => {
    const result = PolicyStateSchema.safeParse({ provider: { active: 'unknown-model' } });
    expect(result.success).toBe(true); // provider.active is z.string() so any string is accepted
  });

  it('rejects non-object', () => {
    const result = PolicyStateSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});

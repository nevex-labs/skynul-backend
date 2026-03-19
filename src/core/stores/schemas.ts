/**
 * Zod schemas for runtime validation of persisted store data.
 *
 * Reuses types from src/types/. Schemas are the validation layer on top.
 * Used with safeParse() — never crashes, always degrades gracefully.
 */

import { z } from 'zod';
import type { CapabilityId, LanguageCode, PolicyState, ProviderId, ThemeMode } from '../../types/policy';
import type { ScheduleFrequency } from '../../types/schedule';
import type { TaskCapabilityId, TaskMode } from '../../types/task';

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  tag: z.string(),
  description: z.string(),
  prompt: z.string(),
  enabled: z.boolean(),
  createdAt: z.number(),
});

export const SkillArraySchema = z.array(SkillSchema);

export const ScheduleSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  capabilities: z.array(z.string()) as z.ZodType<TaskCapabilityId[]>,
  mode: z.enum(['browser', 'code']) as z.ZodType<TaskMode>,
  frequency: z.enum(['daily', 'weekly', 'custom']) as z.ZodType<ScheduleFrequency>,
  cronExpr: z.string(),
  enabled: z.boolean(),
  lastRunAt: z.union([z.number(), z.null()]),
  nextRunAt: z.number(),
  createdAt: z.number(),
});

export const ScheduleArraySchema = z.array(ScheduleSchema);

export const SecretStoreSchema: z.ZodType<Record<string, string>> = z.record(z.string());

export const CapabilityIdSchema = z.enum(['fs.read', 'fs.write', 'cmd.run', 'net.http']) as z.ZodType<CapabilityId>;
export const LanguageCodeSchema = z.enum(['en', 'es']) as z.ZodType<LanguageCode>;
export const ThemeModeSchema = z.enum(['system', 'light', 'dark']) as z.ZodType<ThemeMode>;
export const ProviderIdSchema = z.enum([
  'chatgpt',
  'claude',
  'deepseek',
  'kimi',
  'glm',
  'minimax',
  'openrouter',
  'gemini',
  'ollama',
]) as z.ZodType<ProviderId>;

export const PolicyStateSchema = z.object({
  workspaceRoot: z.union([z.string(), z.null()]).optional(),
  capabilities: z
    .object({
      'fs.read': z.boolean(),
      'fs.write': z.boolean(),
      'cmd.run': z.boolean(),
      'net.http': z.boolean(),
    })
    .optional(),
  themeMode: z.enum(['system', 'light', 'dark']).optional(),
  language: z.enum(['en', 'es']).optional(),
  provider: z
    .object({
      active: z.string(),
      openaiModel: z.string().optional(),
    })
    .optional(),
  taskMemoryEnabled: z.boolean().optional(),
  taskAutoApprove: z.boolean().optional(),
});
